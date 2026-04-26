/**
 * Concurrent auto-org sign-in race — real Prisma test against local Postgres.
 *
 * Spec: `sdd/auth-authorization-guards/spec` § "Auto-Org-on-Signup Invariant"
 *   → Scenario "Concurrent first sign-in produces exactly one org".
 *
 * Design: `sdd/auth-authorization-guards/design` §3 — race-safety contract:
 * the loser tx hits `User_personalOrgId_key` UNIQUE on COMMIT, rolls back
 * its tentative org + membership cleanly, and the catch in `auto-org.ts`
 * swallows P2002(personalOrgId) → idempotent no-throw return.
 *
 * Reliability note (design §"Risks"): `Promise.all` may not produce TRUE
 * concurrency under PG READ COMMITTED on a fast test DB. We accept that
 * if interleaving is sequential, the test still verifies the no-double-org
 * invariant — and the DB UNIQUE constraint IS the contract. A regression
 * (e.g. dropping the UNIQUE index) would surface as 2 orgs created with
 * `Promise.all`, which this test does catch. If observed flake under any
 * driver/version, see design §"Risks" for the `pg_sleep(0.1)` mitigation.
 *
 * DB skip: tests are skipped when local Postgres is unreachable
 * (`localhost:5432`, db `regwatch_dev`, user `postgres`/`root` per project
 * convention). Locally + in CI with PG service: runs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@regwatch/db';
import { createPersonalOrgForUser } from '../auto-org.js';

// Project convention: native local Postgres at this URL. Tests do NOT
// override an explicitly set DATABASE_URL (so CI / non-local setups still
// work), but provide a sane fallback for the dev workstation.
process.env.DATABASE_URL ??= 'postgresql://postgres:root@localhost:5432/regwatch_dev?schema=public';

const prisma = new PrismaClient();

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  // Postgres unreachable — describe.skipIf below will skip the suite.
  dbAvailable = false;
}

function makeUserId(): string {
  // Suffix all races with a fresh random user-id to avoid cross-test
  // interference and to keep the seeded `dev@regwatch.local` user untouched.
  return `race-${randomBytes(8).toString('hex')}`;
}

async function cleanupForUser(userId: string): Promise<void> {
  // Order: drop FK refs first. `personalOrgId` FK uses `onDelete: SetNull`
  // so deleting the org auto-nulls the user pointer; memberships have no
  // ON DELETE so we drop them explicitly.
  const memberships = await prisma.membership.findMany({
    where: { userId },
    select: { organizationId: true },
  });
  const orgIds = memberships.map((m) => m.organizationId);

  await prisma.membership.deleteMany({ where: { userId } });
  // Also include the personalOrgId pointer org (in case membership was
  // never persisted because the loser-side rollback wiped it).
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { personalOrgId: true },
  });
  if (u?.personalOrgId && !orgIds.includes(u.personalOrgId)) {
    orgIds.push(u.personalOrgId);
  }
  if (orgIds.length > 0) {
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  }
  await prisma.user.deleteMany({ where: { id: userId } });
}

describe.skipIf(!dbAvailable)('auto-org race (real Postgres)', () => {
  beforeAll(() => {
    // Sanity log for the operator: explicit when the suite actually runs.

    console.log('[auto-org-race] DB reachable — running real-DB suite');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('two concurrent createPersonalOrgForUser calls produce exactly one org', async () => {
    const userId = makeUserId();
    const email = `${userId}@test.local`;
    await cleanupForUser(userId);
    await prisma.user.create({ data: { id: userId, email } });

    try {
      // Real concurrency under Promise.all. Both calls bypass the
      // top-of-fn `findFirst` short-circuit (no membership yet) and race
      // into the $transaction. Exactly one wins on `User_personalOrgId_key`.
      const results = await Promise.allSettled([
        createPersonalOrgForUser(prisma, { id: userId, email }),
        createPersonalOrgForUser(prisma, { id: userId, email }),
      ]);

      // Public API contract: NEITHER call throws to the caller. Slug
      // collisions retry internally; race-loser P2002 is swallowed.
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected, JSON.stringify(rejected)).toHaveLength(0);

      // Final state: exactly one org, one membership, personalOrgId set.
      const orgs = await prisma.organization.findMany({
        where: { memberships: { some: { userId } } },
      });
      const memberships = await prisma.membership.findMany({ where: { userId } });
      const u = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, personalOrgId: true },
      });

      expect(orgs).toHaveLength(1);
      expect(memberships).toHaveLength(1);
      expect(memberships[0]?.role).toBe('OWNER');
      expect(memberships[0]?.organizationId).toBe(orgs[0]?.id);
      expect(u.personalOrgId).not.toBeNull();
      expect(u.personalOrgId).toBe(orgs[0]?.id);
    } finally {
      await cleanupForUser(userId);
    }
  });

  it('returning user — second call after a successful first is a no-op', async () => {
    const userId = makeUserId();
    const email = `${userId}@test.local`;
    await cleanupForUser(userId);
    await prisma.user.create({ data: { id: userId, email } });

    try {
      await createPersonalOrgForUser(prisma, { id: userId, email });
      const before = await prisma.organization.findMany({
        where: { memberships: { some: { userId } } },
        select: { id: true },
      });
      expect(before).toHaveLength(1);

      // Second call: hits the `findFirst` short-circuit, no writes.
      await createPersonalOrgForUser(prisma, { id: userId, email });

      const after = await prisma.organization.findMany({
        where: { memberships: { some: { userId } } },
        select: { id: true },
      });
      expect(after).toHaveLength(1);
      expect(after[0]?.id).toBe(before[0]?.id);
    } finally {
      await cleanupForUser(userId);
    }
  });
});
