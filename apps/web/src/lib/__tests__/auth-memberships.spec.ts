/**
 * `fetchMemberships()` integration test — real Prisma against local Postgres.
 *
 * Spec: `sdd/org-membership-ux/spec` R-Jwt-Refresh-OnSelfCreate
 *   Scenario 1 ("New membership appears in JWT post-create" → next decoded
 *   JWT contains N+1 entries in `memberships[]`).
 *   Scenario 3 ("No cross-user invalidation" → fetching for user X never
 *   surfaces user Y's memberships).
 *
 * Design: `sdd/org-membership-ux/design` §5 — `update()` propagation
 * audit. `fetchMemberships` is the canonical projection used by both
 * the `jwt` callback in `auth.ts` and this test, so what we assert here
 * is exactly what lands in the JWT after `update()` triggers a refresh.
 *
 * ## DB skip-if-unreachable
 *
 * Mirrors `auto-org-race.test.ts` — the suite is skipped when local
 * Postgres at `regwatch_dev` is unreachable. CI with a Postgres service
 * still runs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@regwatch/db';
import { fetchMemberships, fetchMembershipsVersion } from '../auth-memberships.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:root@localhost:5432/regwatch_dev?schema=public';

const prisma = new PrismaClient();

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

interface SeededOrg {
  id: string;
  slug: string;
}

async function seedUser(n: number): Promise<{ userId: string; orgs: SeededOrg[] }> {
  const tag = randomBytes(6).toString('hex');
  const userId = `mem-${tag}`;
  const email = `${userId}@test.local`;
  await prisma.user.create({ data: { id: userId, email } });
  const orgs: SeededOrg[] = [];
  for (let i = 0; i < n; i += 1) {
    const slug = `mem-${tag}-${i}`;
    const org = await prisma.organization.create({
      data: { slug, name: `Org ${i}` },
      select: { id: true, slug: true },
    });
    await prisma.membership.create({
      data: { userId, organizationId: org.id, role: i === 0 ? 'OWNER' : 'ADMIN' },
    });
    orgs.push(org);
  }
  return { userId, orgs };
}

describe.skipIf(!dbAvailable)('fetchMemberships (real Postgres)', () => {
  const createdUserIds = new Set<string>();
  const createdOrgIds = new Set<string>();

  beforeAll(() => {
    console.log('[fetchMemberships] DB reachable — running real-DB suite');
  });

  afterAll(async () => {
    if (createdUserIds.size > 0) {
      await prisma.membership.deleteMany({ where: { userId: { in: [...createdUserIds] } } });
    }
    if (createdOrgIds.size > 0) {
      await prisma.organization.deleteMany({ where: { id: { in: [...createdOrgIds] } } });
    }
    if (createdUserIds.size > 0) {
      await prisma.user.deleteMany({ where: { id: { in: [...createdUserIds] } } });
    }
    await prisma.$disconnect();
  });

  it('R-Jwt-Refresh-OnSelfCreate S1 — N+1 memberships post-create are visible to the next call', async () => {
    const { userId, orgs } = await seedUser(1);
    createdUserIds.add(userId);
    for (const o of orgs) createdOrgIds.add(o.id);

    // Initial state: 1 membership (mirrors a fresh user's JWT).
    const before = await fetchMemberships(prisma, userId);
    expect(before).toHaveLength(1);
    expect(before[0]?.organizationId).toBe(orgs[0]?.id);
    expect(before[0]?.orgSlug).toBe(orgs[0]?.slug);
    expect(before[0]?.role).toBe('OWNER');

    // Simulate `POST /org` succeeding: a new Organization + Membership(OWNER)
    // pair is inserted (the API does this in a single $transaction; we
    // inline both writes here because we're testing the read side).
    const newSlug = `mem-${randomBytes(4).toString('hex')}-extra`;
    const newOrg = await prisma.organization.create({
      data: { slug: newSlug, name: 'Newly Created' },
      select: { id: true, slug: true },
    });
    createdOrgIds.add(newOrg.id);
    await prisma.membership.create({
      data: { userId, organizationId: newOrg.id, role: 'OWNER' },
    });

    // Now `update()` would re-invoke the jwt callback → fetchMemberships.
    // The next decoded JWT MUST carry both memberships.
    const after = await fetchMemberships(prisma, userId);
    expect(after).toHaveLength(2);
    const ids = after.map((m) => m.organizationId).sort();
    expect(ids).toEqual([orgs[0]!.id, newOrg.id].sort());
    // Every entry projects to the JWT-shaped claim contract.
    for (const m of after) {
      expect(typeof m.organizationId).toBe('string');
      expect(typeof m.orgSlug).toBe('string');
      expect(['OWNER', 'ADMIN', 'ANALYST', 'VIEWER']).toContain(m.role);
    }
  });

  it('R-Jwt-Refresh-OnSelfCreate S3 — cross-user isolation: fetching for X never surfaces Y memberships', async () => {
    const seedX = await seedUser(2);
    const seedY = await seedUser(1);
    createdUserIds.add(seedX.userId);
    createdUserIds.add(seedY.userId);
    for (const o of [...seedX.orgs, ...seedY.orgs]) createdOrgIds.add(o.id);

    const xClaims = await fetchMemberships(prisma, seedX.userId);
    const yClaims = await fetchMemberships(prisma, seedY.userId);

    expect(xClaims).toHaveLength(2);
    expect(yClaims).toHaveLength(1);
    const xIds = new Set(xClaims.map((m) => m.organizationId));
    const yIds = new Set(yClaims.map((m) => m.organizationId));
    // Disjoint — no cross-user JWT contamination.
    for (const id of yIds) expect(xIds.has(id)).toBe(false);
    for (const id of xIds) expect(yIds.has(id)).toBe(false);
  });

  it('returns [] for a user with no memberships', async () => {
    const tag = randomBytes(6).toString('hex');
    const userId = `mem-empty-${tag}`;
    await prisma.user.create({ data: { id: userId, email: `${userId}@test.local` } });
    createdUserIds.add(userId);

    const claims = await fetchMemberships(prisma, userId);
    expect(claims).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // sdd/org-members B1 — R-Jwt-Invalidate-Cross-User (mv claim source)
  // ---------------------------------------------------------------------

  it('fetchMembershipsVersion — fresh user has mv === 0 (default)', async () => {
    const tag = randomBytes(6).toString('hex');
    const userId = `mv-fresh-${tag}`;
    await prisma.user.create({ data: { id: userId, email: `${userId}@test.local` } });
    createdUserIds.add(userId);

    const mv = await fetchMembershipsVersion(prisma, userId);
    expect(mv).toBe(0);
  });

  it('fetchMembershipsVersion — reflects manual increments (chokepoint simulation)', async () => {
    const tag = randomBytes(6).toString('hex');
    const userId = `mv-bump-${tag}`;
    await prisma.user.create({ data: { id: userId, email: `${userId}@test.local` } });
    createdUserIds.add(userId);

    expect(await fetchMembershipsVersion(prisma, userId)).toBe(0);

    // MembersService.mutate() (lands in B3) will issue this exact write
    // inside the same `$transaction` as the Membership change. The read
    // path tested here is what the JWT callback consumes on `update({})`.
    await prisma.user.update({
      where: { id: userId },
      data: { membershipsVersion: { increment: 1 } },
    });
    expect(await fetchMembershipsVersion(prisma, userId)).toBe(1);

    await prisma.user.update({
      where: { id: userId },
      data: { membershipsVersion: { increment: 1 } },
    });
    expect(await fetchMembershipsVersion(prisma, userId)).toBe(2);
  });

  it('fetchMembershipsVersion — returns 0 for unknown userId (defensive)', async () => {
    const mv = await fetchMembershipsVersion(
      prisma,
      `does-not-exist-${randomBytes(4).toString('hex')}`,
    );
    expect(mv).toBe(0);
  });
});
