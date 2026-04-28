import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@regwatch/db/client';
import type { MembershipClaim, Role } from '@regwatch/types';
import { AppModule } from '../../../app.module.js';

/**
 * HTTP integration tests for `OrganizationsController` — boots the full
 * `AppModule` (including the global `JwtAuthGuard` chain) against a real
 * Postgres instance and exercises both endpoints end-to-end via `fetch`.
 *
 * Spec: `sdd/org-membership-ux/spec`
 *   - R-Org-GetMe   — Scenarios 1–3 (auth + 1 / 3 memberships / 401)
 *   - R-OrgCreate   — Scenarios 1–4 (atomicity / concurrent / 400 / 401)
 *
 * Design: `sdd/org-membership-ux/design` §2 (echo-only `activeOrgId`,
 * 201 + `Cache-Control: no-store`).
 *
 * ## Why the bare `/org/*` paths
 *
 * `apps/api/src/main.ts` does NOT call `setGlobalPrefix('api')` — see
 * discovery `apps-api-no-global-prefix`. The `/api/org/...` URL shape in
 * spec/design refers to the WEB-layer external URL; the Nest server itself
 * mounts the controller at `/org` (decorator: `@Controller('org')`).
 *
 * ## Why the spec scenario "no cookie → activeOrgId === memberships[0].orgId"
 * is asserted as `null` here (NOT auto-pick)
 *
 * Per design §2 the API is echo-only: it mirrors `X-Org-Id` if valid, else
 * returns `null`. Auto-pick is fulfilled at the SYSTEM boundary by the WEB
 * layer's `ensureActiveOrg` server action (B3.2) before forwarding to
 * `/org/me`. The end-to-end auto-pick assertion lives in the Playwright
 * spec (B6.1), not in the api-only suite.
 *
 * ## DB skip-if-unreachable
 *
 * Mirrors `apps/web/src/lib/__tests__/auto-org-race.test.ts` — the suite
 * is skipped when local Postgres at `regwatch_dev` is unreachable. CI with
 * a Postgres service still runs.
 */

// Project convention: native local Postgres; do NOT override an explicit
// DATABASE_URL set by the operator/CI. `vitest.setup.ts` defaults to a
// throwaway placeholder (`postgresql://test:test@localhost:5432/test`) so
// that `createApiEnv()` parses cleanly at module-eval time — replace that
// (and only that) with the real dev URL so the probe below actually tries
// the local Postgres instead of skipping every test silently.
const PLACEHOLDER_DB_URL = 'postgresql://test:test@localhost:5432/test';
if (!process.env.DATABASE_URL || process.env.DATABASE_URL === PLACEHOLDER_DB_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:root@localhost:5432/regwatch_dev?schema=public';
}
// vitest.setup.ts already sets AUTH_SECRET; reuse the same secret here so
// the JwtVerifier inside the booted Nest app accepts our signed tokens.
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

interface SeededUser {
  userId: string;
  email: string;
  orgs: Array<{ id: string; slug: string; name: string; role: Role }>;
}

/**
 * Mint an HS256 JWT in the exact shape `JwtVerifier` (jose) expects.
 * Mirrors `apps/web/src/lib/auth.ts`'s `jwt.encode` override (R-Sign).
 *
 * Optional `iss`/`aud` are omitted when env doesn't set the matching
 * variables — `JwtVerifier` only enforces them when configured.
 */
async function mintJwt(opts: {
  userId: string;
  email: string;
  memberships: MembershipClaim[];
  ttlSeconds?: number;
}): Promise<string> {
  const key = new TextEncoder().encode(AUTH_SECRET);
  return await new SignJWT({
    userId: opts.userId,
    email: opts.email,
    memberships: opts.memberships,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(opts.userId)
    .setIssuedAt()
    .setExpirationTime(`${opts.ttlSeconds ?? 60 * 5}s`)
    .sign(key);
}

describe.skipIf(!dbAvailable)('OrganizationsController (HTTP integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let prisma: PrismaClient;
  // Track every userId/orgId we create so afterAll can clean DB rows even
  // if a test mid-flight throws.
  const createdUserIds = new Set<string>();
  const createdOrgIds = new Set<string>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    // `listen(0)` binds an ephemeral port — avoids collisions with parallel
    // suites and the dev server.
    const server = await app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to determine listen address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    // Memberships first (no FK cascade from User), then orgs (FK from
    // Membership cascades), then users.
    if (createdUserIds.size > 0) {
      await prisma.membership.deleteMany({
        where: { userId: { in: [...createdUserIds] } },
      });
    }
    if (createdOrgIds.size > 0) {
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

  /**
   * Seed a user + N memberships in real Postgres. The user's
   * `personalOrgId` is set to `orgs[personalIndex]` so `isPersonal` lights
   * up for that membership. Returns the JWT-shaped membership claims so
   * tests can sign tokens that match the DB state.
   */
  async function seedUserWithOrgs(
    n: number,
    opts: { personalIndex?: number | null } = {},
  ): Promise<SeededUser> {
    const tag = randomBytes(6).toString('hex');
    const userId = `int-${tag}`;
    const email = `${userId}@test.local`;
    createdUserIds.add(userId);
    await prisma.user.create({ data: { id: userId, email } });
    const orgs: SeededUser['orgs'] = [];
    for (let i = 0; i < n; i += 1) {
      const slug = `int-${tag}-${i}`;
      const org = await prisma.organization.create({
        data: { slug, name: `Org ${i}` },
        select: { id: true, slug: true, name: true },
      });
      createdOrgIds.add(org.id);
      const role: Role = i === 0 ? 'OWNER' : 'ADMIN';
      await prisma.membership.create({
        data: { userId, organizationId: org.id, role },
      });
      orgs.push({ ...org, role });
    }
    if (opts.personalIndex !== null) {
      const idx = opts.personalIndex ?? 0;
      const target = orgs[idx];
      if (!target) throw new Error('personalIndex out of range');
      await prisma.user.update({
        where: { id: userId },
        data: { personalOrgId: target.id },
      });
    }
    return { userId, email, orgs };
  }

  function membershipsClaim(seed: SeededUser): MembershipClaim[] {
    return seed.orgs.map((o) => ({
      organizationId: o.id,
      orgSlug: o.slug,
      role: o.role,
    }));
  }

  // -------------------------------------------------------------------- //
  // R-Org-GetMe                                                          //
  // -------------------------------------------------------------------- //

  describe('GET /org/me', () => {
    it('R-Org-GetMe S1 — single personal membership, no X-Org-Id → activeOrgId=null, isPersonal=true (api echo-only per design §2)', async () => {
      const seed = await seedUserWithOrgs(1, { personalIndex: 0 });
      const jwt = await mintJwt({
        userId: seed.userId,
        email: seed.email,
        memberships: membershipsClaim(seed),
      });

      const res = await fetch(`${baseUrl}/org/me`, {
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(res.status).toBe(200);
      // Cache-Control: no-store contract (decision #3).
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = (await res.json()) as {
        memberships: Array<{ orgId: string; isPersonal: boolean; role: Role; orgName: string }>;
        activeOrgId: string | null;
      };
      expect(body.memberships).toHaveLength(1);
      expect(body.memberships[0]?.orgId).toBe(seed.orgs[0]?.id);
      expect(body.memberships[0]?.isPersonal).toBe(true);
      expect(body.memberships[0]?.role).toBe('OWNER');
      expect(body.memberships[0]?.orgName).toBe('Org 0');
      expect(body.activeOrgId).toBeNull();
    });

    it('R-Org-GetMe S2 — three memberships with X-Org-Id → activeOrgId echoes that header', async () => {
      const seed = await seedUserWithOrgs(3, { personalIndex: 1 });
      const jwt = await mintJwt({
        userId: seed.userId,
        email: seed.email,
        memberships: membershipsClaim(seed),
      });
      const target = seed.orgs[1];
      if (!target) throw new Error('seed missing target');

      const res = await fetch(`${baseUrl}/org/me`, {
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': target.id },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        memberships: Array<{ isPersonal: boolean; orgId: string }>;
        activeOrgId: string | null;
      };
      expect(body.memberships).toHaveLength(3);
      expect(body.activeOrgId).toBe(target.id);
      // isPersonal lights only on personalOrgId match
      expect(body.memberships.map((m) => m.isPersonal)).toEqual([false, true, false]);
    });

    it('R-Org-GetMe — X-Org-Id not in memberships → activeOrgId=null (defensive echo)', async () => {
      const seed = await seedUserWithOrgs(1, { personalIndex: 0 });
      const jwt = await mintJwt({
        userId: seed.userId,
        email: seed.email,
        memberships: membershipsClaim(seed),
      });

      const res = await fetch(`${baseUrl}/org/me`, {
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': 'org-not-yours' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { activeOrgId: string | null };
      expect(body.activeOrgId).toBeNull();
    });

    it('R-Org-GetMe S3 — no Authorization header → 401', async () => {
      const res = await fetch(`${baseUrl}/org/me`);
      expect(res.status).toBe(401);
    });

    it('R-Org-GetMe — bad signature → 401 (Bearer with garbage token)', async () => {
      const res = await fetch(`${baseUrl}/org/me`, {
        headers: { authorization: 'Bearer not-a-real-jwt' },
      });
      expect(res.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------- //
  // R-OrgCreate                                                          //
  // -------------------------------------------------------------------- //

  describe('POST /org', () => {
    it('R-OrgCreate S1 — success creates org+membership atomically (DB count delta +1/+1)', async () => {
      const seed = await seedUserWithOrgs(1, { personalIndex: 0 });
      const jwt = await mintJwt({
        userId: seed.userId,
        email: seed.email,
        memberships: membershipsClaim(seed),
      });
      const orgsBefore = await prisma.organization.count();
      const membsBefore = await prisma.membership.count({ where: { userId: seed.userId } });

      const res = await fetch(`${baseUrl}/org`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${jwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'Acme' }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; name: string; slug: string };
      expect(body.name).toBe('Acme');
      expect(body.slug).toMatch(/^[A-Za-z0-9_-]+$/);
      createdOrgIds.add(body.id);

      const orgsAfter = await prisma.organization.count();
      const membsAfter = await prisma.membership.count({ where: { userId: seed.userId } });
      expect(orgsAfter - orgsBefore).toBe(1);
      expect(membsAfter - membsBefore).toBe(1);

      const memb = await prisma.membership.findFirstOrThrow({
        where: { userId: seed.userId, organizationId: body.id },
      });
      expect(memb.role).toBe('OWNER');
    });

    it('R-OrgCreate S3 — concurrent creates by same user produce 2 distinct orgs (NOT the auto-org invariant — design §2 / foot-gun #645)', async () => {
      const seed = await seedUserWithOrgs(1, { personalIndex: 0 });
      const jwt = await mintJwt({
        userId: seed.userId,
        email: seed.email,
        memberships: membershipsClaim(seed),
      });

      const make = (): Promise<Response> =>
        fetch(`${baseUrl}/org`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${jwt}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ name: 'Parallel' }),
        });

      const [r1, r2] = await Promise.all([make(), make()]);
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      const b1 = (await r1.json()) as { id: string };
      const b2 = (await r2.json()) as { id: string };
      createdOrgIds.add(b1.id);
      createdOrgIds.add(b2.id);
      expect(b1.id).not.toBe(b2.id);

      const memberships = await prisma.membership.findMany({
        where: { userId: seed.userId, organizationId: { in: [b1.id, b2.id] } },
      });
      expect(memberships).toHaveLength(2);
      for (const m of memberships) expect(m.role).toBe('OWNER');
    });

    it('R-OrgCreate — empty name → 400 (Zod validation)', async () => {
      const seed = await seedUserWithOrgs(1, { personalIndex: 0 });
      const jwt = await mintJwt({
        userId: seed.userId,
        email: seed.email,
        memberships: membershipsClaim(seed),
      });

      const res = await fetch(`${baseUrl}/org`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${jwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: '   ' }), // trims to ''
      });
      expect(res.status).toBe(400);
    });

    it('R-OrgCreate — oversize name (>80 chars) → 400', async () => {
      const seed = await seedUserWithOrgs(1, { personalIndex: 0 });
      const jwt = await mintJwt({
        userId: seed.userId,
        email: seed.email,
        memberships: membershipsClaim(seed),
      });

      const res = await fetch(`${baseUrl}/org`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${jwt}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'x'.repeat(81) }),
      });
      expect(res.status).toBe(400);
    });

    it('R-OrgCreate S4 — no Authorization → 401', async () => {
      const res = await fetch(`${baseUrl}/org`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'NoAuth' }),
      });
      expect(res.status).toBe(401);
    });
  });
});
