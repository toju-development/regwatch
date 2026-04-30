import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@regwatch/db/client';
import { startOfMonthUtc } from '@regwatch/db/usage';
import type { MembershipClaim, Role } from '@regwatch/types';
import { AppModule } from '../../../app.module.js';

/**
 * HTTP integration tests for `UsageController` — boots the full
 * `AppModule` (including the global guard chain
 * `JwtAuthGuard` → `MembershipFreshnessGuard` → `OrgScopeGuard` →
 * `RolesGuard`) against a real Postgres instance and exercises
 * `GET /org/:orgId/usage/current` end-to-end via `fetch`.
 *
 * Spec: `sdd/scanner-vertical-ar/spec` R-11-CanScanThisMonth,
 *   R-12-UsageReadEndpoint, R-13-UsageWidget (consumer), INV-SP-3
 *   (Decimal end-to-end), INV-UT-1 (single source of truth via the
 *   `getMonthlyUsage` helper), INV-UT-2 (no caching MVP-5).
 * Design: `sdd/scanner-vertical-ar/design` ADR-11 (response shape +
 *   guard chain).
 *
 * ## Why bare `/org/...` paths
 *
 * `apps/api/src/main.ts` does NOT call `setGlobalPrefix('api')` — see
 * discovery `apps-api-no-global-prefix`. The `/api/org/...` URL shape
 * lives at the WEB layer (PROXY MODE #666) and is exercised by B7's
 * web-side tests.
 *
 * ## DB skip-if-unreachable
 *
 * Mirrors `settings.integration.spec.ts` — skipped when local Postgres
 * at `regwatch_dev` is unreachable. CI with a Postgres service still
 * runs the suite.
 *
 * ## Foot-gun #687: scoped reads only
 *
 * NEVER do `prisma.scanLog.count()` — vitest runs spec files in
 * parallel against the SAME `regwatch_dev` database, so global counts
 * see deltas from sibling specs in flight. ALL reads are scoped to a
 * seeded `organizationId`.
 */

const PLACEHOLDER_DB_URL = 'postgresql://test:test@localhost:5432/test';
if (!process.env.DATABASE_URL || process.env.DATABASE_URL === PLACEHOLDER_DB_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:root@localhost:5432/regwatch_dev?schema=public';
}
const AUTH_SECRET = process.env.AUTH_SECRET ?? 'test-auth-secret-must-be-at-least-32-chars-ok';
process.env.AUTH_SECRET = AUTH_SECRET;

const probe = new PrismaClient();
let dbAvailable = false;
try {
  await probe.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
} finally {
  await probe.$disconnect();
}

async function mintJwt(opts: {
  userId: string;
  email: string;
  memberships: MembershipClaim[];
  ttlSeconds?: number;
  mv?: number;
}): Promise<string> {
  const key = new TextEncoder().encode(AUTH_SECRET);
  return await new SignJWT({
    userId: opts.userId,
    email: opts.email,
    memberships: opts.memberships,
    mv: opts.mv ?? 0,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(opts.userId)
    .setIssuedAt()
    .setExpirationTime(`${opts.ttlSeconds ?? 60 * 5}s`)
    .sign(key);
}

describe.skipIf(!dbAvailable)('UsageController (HTTP integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let prisma: PrismaClient;
  const createdUserIds = new Set<string>();
  const createdOrgIds = new Set<string>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const server = await app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to determine listen address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    if (createdOrgIds.size > 0) {
      // ScanLog cascade-deletes via FK onDelete: Cascade — dropping orgs
      // takes them with us. Detach personalOrg refs first to avoid FK
      // violations when nuking orgs that are someone's personal org.
      await prisma.user.updateMany({
        where: { id: { in: [...createdUserIds] } },
        data: { personalOrgId: null },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: [...createdOrgIds] } },
      });
    }
    if (createdUserIds.size > 0) {
      await prisma.user.deleteMany({ where: { id: { in: [...createdUserIds] } } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  async function createUser(): Promise<{ userId: string; email: string }> {
    const tag = randomBytes(6).toString('hex');
    const userId = `int-usg-${tag}`;
    const email = `${userId}@test.local`;
    createdUserIds.add(userId);
    await prisma.user.create({ data: { id: userId, email } });
    return { userId, email };
  }

  async function createOrg(): Promise<{ id: string; slug: string; name: string }> {
    const tag = randomBytes(6).toString('hex');
    const slug = `int-usg-${tag}`;
    const org = await prisma.organization.create({
      data: { slug, name: `Org ${tag}` },
      select: { id: true, slug: true, name: true },
    });
    createdOrgIds.add(org.id);
    return org;
  }

  async function addMembership(userId: string, orgId: string, role: Role): Promise<void> {
    await prisma.membership.create({ data: { userId, organizationId: orgId, role } });
  }

  async function seed(role: Role): Promise<{
    org: { id: string; slug: string; name: string };
    actor: { userId: string; email: string };
  }> {
    const org = await createOrg();
    const actor = await createUser();
    await addMembership(actor.userId, org.id, role);
    return { org, actor };
  }

  function membershipsClaim(
    orgs: Array<{ id: string; slug: string; role: Role }>,
  ): MembershipClaim[] {
    return orgs.map((o) => ({ organizationId: o.id, orgSlug: o.slug, role: o.role }));
  }

  async function getJwt(
    actor: { userId: string; email: string },
    org: { id: string; slug: string },
    role: Role,
    overrides: { mv?: number } = {},
  ): Promise<string> {
    const opts: Parameters<typeof mintJwt>[0] = {
      userId: actor.userId,
      email: actor.email,
      memberships: membershipsClaim([{ id: org.id, slug: org.slug, role }]),
    };
    if (overrides.mv !== undefined) opts.mv = overrides.mv;
    return await mintJwt(opts);
  }

  async function seedScan(
    orgId: string,
    opts: {
      tokensUsed?: number;
      costUsd?: string;
      startedAt?: Date;
      jurisdiction?: string;
    } = {},
  ): Promise<void> {
    await prisma.scanLog.create({
      data: {
        organizationId: orgId,
        jurisdiction: opts.jurisdiction ?? 'AR',
        status: 'COMPLETED',
        tokensUsed: opts.tokensUsed ?? 1000,
        costUsd: new Prisma.Decimal(opts.costUsd ?? '0.123456'),
        startedAt: opts.startedAt ?? new Date(),
        completedAt: new Date(),
        alertsFound: 0,
      },
    });
  }

  // ------------------------------------------------------------------ //
  // GET /org/:orgId/usage/current — R-12-UsageReadEndpoint             //
  // ------------------------------------------------------------------ //

  describe('GET /org/:orgId/usage/current', () => {
    it('zero-usage org → 200 with empty aggregates + Cache-Control: no-store', async () => {
      // Empty `ScanLog` aggregate path. INV-UT-2 (no caching MVP-5) is
      // pinned at the wire via the `Cache-Control: no-store` header.
      const { org, actor } = await seed('OWNER');
      const jwt = await getJwt(actor, org, 'OWNER');

      const res = await fetch(`${baseUrl}/org/${org.id}/usage/current`, {
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');

      const body = (await res.json()) as {
        currentMonth: {
          tokensUsed: number;
          costUsd: string;
          scansCount: number;
          capUsd: string;
          percent: number;
          monthStart: string;
        };
        isAtCap: boolean;
      };
      expect(body.currentMonth.tokensUsed).toBe(0);
      expect(body.currentMonth.scansCount).toBe(0);
      expect(body.currentMonth.costUsd).toBe('0');
      expect(body.currentMonth.capUsd).toBe('10');
      expect(body.currentMonth.percent).toBe(0);
      expect(body.isAtCap).toBe(false);
      // monthStart MUST equal `startOfMonthUtc(now)` in ISO form — the
      // helper anchors the lower bound there for both API + scanner gate.
      expect(body.currentMonth.monthStart).toBe(startOfMonthUtc(new Date()).toISOString());
    });

    it('seeded just-under cap → costUsd / tokens / scansCount aggregate scoped to org', async () => {
      // Foot-gun #687: aggregate MUST be scoped to seeded `organizationId`.
      // We seed two scans for OUR org and ZERO for sibling specs' orgs;
      // global SUM would be polluted by parallel-running specs.
      const { org, actor } = await seed('OWNER');
      const jwt = await getJwt(actor, org, 'OWNER');
      await seedScan(org.id, { tokensUsed: 1500, costUsd: '1.500000' });
      await seedScan(org.id, { tokensUsed: 2500, costUsd: '2.500000' });

      const res = await fetch(`${baseUrl}/org/${org.id}/usage/current`, {
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        currentMonth: { tokensUsed: number; costUsd: string; scansCount: number; percent: number };
        isAtCap: boolean;
      };
      expect(body.currentMonth.tokensUsed).toBe(4000);
      // INV-SP-3: Decimals serialized as strings, full precision (no
      // float drift). Sum of $1.5 + $2.5 = $4. Helper returns Decimal,
      // DTO calls `.toString()`.
      expect(body.currentMonth.costUsd).toBe('4');
      expect(body.currentMonth.scansCount).toBe(2);
      // 4 / 10 * 100 = 40 (integer-truncated by helper).
      expect(body.currentMonth.percent).toBe(40);
      expect(body.isAtCap).toBe(false);
    });

    it('exactly-at-cap (cost = $10) → isAtCap=true, percent=100 (R-5 boundary)', async () => {
      // R-5 boundary scenario: `costUsd >= capUsd` — exactly at cap
      // counts AS at-cap (the next scan MUST be skipped). Pin the
      // boundary at the WIRE (DTO surface), not just the helper unit.
      const { org, actor } = await seed('OWNER');
      const jwt = await getJwt(actor, org, 'OWNER');
      await seedScan(org.id, { tokensUsed: 100_000, costUsd: '10.000000' });

      const res = await fetch(`${baseUrl}/org/${org.id}/usage/current`, {
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        currentMonth: { costUsd: string; percent: number };
        isAtCap: boolean;
      };
      expect(body.currentMonth.costUsd).toBe('10');
      expect(body.currentMonth.percent).toBe(100);
      expect(body.isAtCap).toBe(true);
    });

    it('over-cap → percent clamped to 100 at DTO boundary (ADR-6 over-shoot path)', async () => {
      // ADR-6: a scan that started just under cap MAY commit slightly
      // over (max ~$0.10 overrun per worst-case run). The HELPER returns
      // the raw percent (>100 here, ~$10.50 → 105%); the DTO mapper
      // clamps for the widget so the progress bar doesn't overflow.
      // Helper-level cost stays faithful for cost-monitoring paths.
      const { org, actor } = await seed('OWNER');
      const jwt = await getJwt(actor, org, 'OWNER');
      await seedScan(org.id, { tokensUsed: 110_000, costUsd: '10.500000' });

      const res = await fetch(`${baseUrl}/org/${org.id}/usage/current`, {
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        currentMonth: { costUsd: string; percent: number };
        isAtCap: boolean;
      };
      // Decimal precision preserved: "10.5" (Prisma's canonical form).
      expect(body.currentMonth.costUsd).toBe('10.5');
      expect(body.currentMonth.percent).toBe(100);
      expect(body.isAtCap).toBe(true);
    });

    it('previous-month scans are EXCLUDED from the aggregate (helper monthStart bound)', async () => {
      // Helper uses `startOfMonthUtc(now)` as the inclusive lower bound.
      // We seed one scan with `startedAt` ONE second before this month
      // starts (last second of the previous month) — it MUST NOT count.
      const { org, actor } = await seed('OWNER');
      const jwt = await getJwt(actor, org, 'OWNER');
      const monthStart = startOfMonthUtc(new Date());
      const justBefore = new Date(monthStart.getTime() - 1_000);
      await seedScan(org.id, {
        tokensUsed: 999,
        costUsd: '5.000000',
        startedAt: justBefore,
      });
      // Plus one scan THIS month for sanity (the only one that should count).
      await seedScan(org.id, { tokensUsed: 100, costUsd: '0.100000' });

      const res = await fetch(`${baseUrl}/org/${org.id}/usage/current`, {
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
      });
      const body = (await res.json()) as {
        currentMonth: { tokensUsed: number; costUsd: string; scansCount: number };
      };
      expect(body.currentMonth.tokensUsed).toBe(100);
      expect(body.currentMonth.costUsd).toBe('0.1');
      expect(body.currentMonth.scansCount).toBe(1);
    });

    it.each<[Role]>([['OWNER'], ['ADMIN'], ['ANALYST'], ['VIEWER']])(
      'role %s — any member may read (no @Roles on GET, R-12)',
      async (role) => {
        // R-12 spec scenario: "VIEWER can read own-org usage". The full
        // role matrix passes — there is NO `@Roles(...)` on this handler.
        const { org, actor } = await seed(role);
        const jwt = await getJwt(actor, org, role);
        const res = await fetch(`${baseUrl}/org/${org.id}/usage/current`, {
          headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
        });
        expect(res.status).toBe(200);
      },
    );

    it('anonymous → 401 (JwtAuthGuard)', async () => {
      const { org } = await seed('OWNER');
      const res = await fetch(`${baseUrl}/org/${org.id}/usage/current`);
      expect(res.status).toBe(401);
    });

    it('non-member of :orgId → 403 (OrgScopeGuard) and NO leak of usage data', async () => {
      // Caller is a member of `orgOwn` but tries to read `orgA`. The
      // X-Org-Id header points at `orgA` → OrgScopeGuard rejects since
      // the caller's `memberships[]` claim has no orgA entry. 403, NOT
      // 401 (the principal IS authenticated).
      const orgA = await createOrg();
      const { actor, org: orgOwn } = await seed('OWNER');
      const jwt = await getJwt(actor, orgOwn, 'OWNER');
      const res = await fetch(`${baseUrl}/org/${orgA.id}/usage/current`, {
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': orgA.id },
      });
      expect(res.status).toBe(403);
    });

    it('cross-org :orgId / X-Org-Id mismatch → 403 (assertOrgScope defense-in-depth)', async () => {
      // Caller IS member of orgB; the `X-Org-Id` header resolves to
      // orgB (OrgScopeGuard passes), but the URL `:orgId` segment
      // references orgA. The handler's `assertOrgScope` short-circuits
      // to 403 before ever touching the service, so no orgA usage data
      // leaks. This is the "two header sources of truth disagree" case.
      const orgA = await createOrg();
      const { actor, org: orgB } = await seed('OWNER');
      const jwt = await mintJwt({
        userId: actor.userId,
        email: actor.email,
        memberships: membershipsClaim([{ id: orgB.id, slug: orgB.slug, role: 'OWNER' }]),
      });
      const res = await fetch(`${baseUrl}/org/${orgA.id}/usage/current`, {
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': orgB.id },
      });
      expect(res.status).toBe(403);
    });

    it('stale mv → 401 STALE_MEMBERSHIPS (MembershipFreshnessGuard)', async () => {
      // Server-side `membershipsVersion` bump invalidates the JWT (mv=0).
      // The freshness guard rejects with the typed `STALE_MEMBERSHIPS`
      // code so the web client knows to refresh the session.
      const { org, actor } = await seed('OWNER');
      await prisma.user.update({
        where: { id: actor.userId },
        data: { membershipsVersion: { increment: 1 } },
      });
      const jwt = await getJwt(actor, org, 'OWNER', { mv: 0 });
      const res = await fetch(`${baseUrl}/org/${org.id}/usage/current`, {
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe('STALE_MEMBERSHIPS');
    });
  });
});
