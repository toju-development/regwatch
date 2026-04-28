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
 * HTTP integration tests for `MembersController` — boots the full
 * `AppModule` (including the global guard chain
 * `JwtAuthGuard` → `MembershipFreshnessGuard` → `OrgScopeGuard` →
 * `RolesGuard`, plus the handler-level `RolesOrSelfGuard`) against a real
 * Postgres instance and exercises every endpoint end-to-end via `fetch`.
 *
 * Spec: `sdd/org-members/spec`
 *   - R-Members-List
 *   - R-Membership-Update (Q7-A list, Q8 self-target, last-OWNER, ADMIN→OWNER)
 *   - R-Membership-Remove (personalOrg, OWNER-removes-OWNER, last-OWNER)
 *
 * Design: `sdd/org-members/design` §0 #1-#2, §2, §5.
 *
 * ## Why bare `/org/...` paths
 *
 * `apps/api/src/main.ts` does NOT call `setGlobalPrefix('api')` — see
 * discovery `apps-api-no-global-prefix`. The `/api/org/...` URL shape
 * lives at the WEB layer (PROXY MODE #666 — landing in B5).
 *
 * ## DB skip-if-unreachable
 *
 * Mirrors `organizations.integration.spec.ts` — skipped when local
 * Postgres at `regwatch_dev` is unreachable. CI with a Postgres service
 * still runs.
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

interface SeededUser {
  userId: string;
  email: string;
  orgs: Array<{ id: string; slug: string; name: string; role: Role }>;
}
// Reserved for future multi-org seed helpers; kept exported via type-only
// reference so eslint doesn't drop it.
export type { SeededUser };

/**
 * Mint an HS256 JWT in the exact shape `JwtVerifier` (jose) expects.
 * `mv` defaults to `0` to match the seeded `User.membershipsVersion`
 * (B2 freshness guard rejects mv mismatch with 401 STALE_MEMBERSHIPS).
 */
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

describe.skipIf(!dbAvailable)('MembersController (HTTP integration)', () => {
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
    if (createdUserIds.size > 0) {
      await prisma.membership.deleteMany({
        where: { userId: { in: [...createdUserIds] } },
      });
    }
    if (createdOrgIds.size > 0) {
      await prisma.membership.deleteMany({
        where: { organizationId: { in: [...createdOrgIds] } },
      });
      // Clear personalOrgId before deleting orgs to avoid FK violations.
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

  /**
   * Create a single user and (optionally) attach memberships of varying
   * roles to a given org. `personalOrgId` is set to the matching org
   * when `isPersonal` is requested for that membership.
   */
  async function createUser(email?: string): Promise<{ userId: string; email: string }> {
    const tag = randomBytes(6).toString('hex');
    const userId = `int-mem-${tag}`;
    const ee = email ?? `${userId}@test.local`;
    createdUserIds.add(userId);
    await prisma.user.create({ data: { id: userId, email: ee } });
    return { userId, email: ee };
  }

  async function createOrg(): Promise<{ id: string; slug: string; name: string }> {
    const tag = randomBytes(6).toString('hex');
    const slug = `int-mem-${tag}`;
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

  /**
   * Seed an org plus N members with the given roles. The first user is
   * the "actor"; remaining users are the "others". Each user is created
   * with mv=0. `personalIndex` (per user) marks which org is the user's
   * personalOrg.
   */
  async function seedOrgWithRoles(
    actorRole: Role,
    otherRoles: Role[] = [],
  ): Promise<{
    org: { id: string; slug: string; name: string };
    actor: { userId: string; email: string };
    others: Array<{ userId: string; email: string; role: Role }>;
  }> {
    const org = await createOrg();
    const actor = await createUser();
    await addMembership(actor.userId, org.id, actorRole);
    const others: Array<{ userId: string; email: string; role: Role }> = [];
    for (const role of otherRoles) {
      const u = await createUser();
      await addMembership(u.userId, org.id, role);
      others.push({ ...u, role });
    }
    return { org, actor, others };
  }

  function membershipsClaim(
    orgs: Array<{ id: string; slug: string; role: Role }>,
  ): MembershipClaim[] {
    return orgs.map((o) => ({
      organizationId: o.id,
      orgSlug: o.slug,
      role: o.role,
    }));
  }

  async function readMv(userId: string): Promise<number> {
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { membershipsVersion: true },
    });
    return row.membershipsVersion;
  }

  // -------------------------------------------------------------------- //
  // R-Members-List — GET /org/:orgId/members                             //
  // -------------------------------------------------------------------- //

  describe('GET /org/:orgId/members', () => {
    it('R-Members-List — VIEWER can list (Q7-A: every role lists), Cache-Control: no-store, ordered by joinedAt ASC', async () => {
      const { org, actor, others } = await seedOrgWithRoles('VIEWER', ['OWNER', 'ADMIN']);
      const jwt = await mintJwt({
        userId: actor.userId,
        email: actor.email,
        memberships: membershipsClaim([{ id: org.id, slug: org.slug, role: 'VIEWER' }]),
      });

      const res = await fetch(`${baseUrl}/org/${org.id}/members`, {
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = (await res.json()) as {
        members: Array<{ userId: string; role: Role; joinedAt: string }>;
      };
      expect(body.members).toHaveLength(3);
      // Order: actor was inserted first, then the two others in array order.
      expect(body.members[0]?.userId).toBe(actor.userId);
      expect(body.members[1]?.userId).toBe(others[0]?.userId);
      expect(body.members[2]?.userId).toBe(others[1]?.userId);
      // joinedAt is ISO string.
      expect(typeof body.members[0]?.joinedAt).toBe('string');
      expect(() => new Date(body.members[0]!.joinedAt).toISOString()).not.toThrow();
    });

    it('R-Members-List — no Authorization → 401', async () => {
      const { org } = await seedOrgWithRoles('OWNER');
      const res = await fetch(`${baseUrl}/org/${org.id}/members`);
      expect(res.status).toBe(401);
    });

    it('R-Members-List — :orgId mismatch X-Org-Id (caller is member of X-Org-Id but not :orgId) → 403 (OrgScopeGuard then defense-in-depth)', async () => {
      // Caller is member of orgA; we hit /org/orgB/members with X-Org-Id: orgA.
      const { org: orgA, actor } = await seedOrgWithRoles('OWNER');
      const orgB = await createOrg();
      const jwt = await mintJwt({
        userId: actor.userId,
        email: actor.email,
        memberships: membershipsClaim([{ id: orgA.id, slug: orgA.slug, role: 'OWNER' }]),
      });
      const res = await fetch(`${baseUrl}/org/${orgB.id}/members`, {
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': orgA.id },
      });
      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------- //
  // R-Membership-Update — PATCH /org/:orgId/members/:userId              //
  // -------------------------------------------------------------------- //

  describe('PATCH /org/:orgId/members/:userId', () => {
    it('R-Membership-Update — ADMIN demotes ANALYST → 204 + bumps target mv', async () => {
      const { org, actor, others } = await seedOrgWithRoles('ADMIN', ['ANALYST']);
      const target = others[0]!;
      const jwt = await mintJwt({
        userId: actor.userId,
        email: actor.email,
        memberships: membershipsClaim([{ id: org.id, slug: org.slug, role: 'ADMIN' }]),
      });
      const targetMvBefore = await readMv(target.userId);

      const res = await fetch(`${baseUrl}/org/${org.id}/members/${target.userId}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${jwt}`,
          'x-org-id': org.id,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ role: 'VIEWER' }),
      });
      expect(res.status).toBe(204);

      const row = await prisma.membership.findUniqueOrThrow({
        where: { userId_organizationId: { userId: target.userId, organizationId: org.id } },
      });
      expect(row.role).toBe('VIEWER');
      expect(await readMv(target.userId)).toBe(targetMvBefore + 1);
    });

    it('R-Membership-Update Q8 — ANALYST self-downgrade to VIEWER → 204 (RolesOrSelf self-target)', async () => {
      const { org, actor } = await seedOrgWithRoles('ANALYST');
      const jwt = await mintJwt({
        userId: actor.userId,
        email: actor.email,
        memberships: membershipsClaim([{ id: org.id, slug: org.slug, role: 'ANALYST' }]),
      });

      const res = await fetch(`${baseUrl}/org/${org.id}/members/${actor.userId}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${jwt}`,
          'x-org-id': org.id,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ role: 'VIEWER' }),
      });
      expect(res.status).toBe(204);
    });

    it('R-Membership-Update — ANALYST tries to PATCH another user (not self) → 403 (RolesOrSelf rejects)', async () => {
      const { org, actor, others } = await seedOrgWithRoles('ANALYST', ['VIEWER']);
      const target = others[0]!;
      const jwt = await mintJwt({
        userId: actor.userId,
        email: actor.email,
        memberships: membershipsClaim([{ id: org.id, slug: org.slug, role: 'ANALYST' }]),
      });

      const res = await fetch(`${baseUrl}/org/${org.id}/members/${target.userId}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${jwt}`,
          'x-org-id': org.id,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ role: 'VIEWER' }),
      });
      expect(res.status).toBe(403);
    });

    it('R-Membership-Update — VIEWER self-promote to ADMIN → 403 SELF_PROMOTE_FORBIDDEN', async () => {
      const { org, actor } = await seedOrgWithRoles('VIEWER');
      const jwt = await mintJwt({
        userId: actor.userId,
        email: actor.email,
        memberships: membershipsClaim([{ id: org.id, slug: org.slug, role: 'VIEWER' }]),
      });

      const res = await fetch(`${baseUrl}/org/${org.id}/members/${actor.userId}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${jwt}`,
          'x-org-id': org.id,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ role: 'ADMIN' }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe('SELF_PROMOTE_FORBIDDEN');
    });

    it('R-Membership-Update — ADMIN promotes ANALYST to OWNER (cross-user) → 403 OWNER_PROMOTE_REQUIRES_OWNER', async () => {
      const { org, actor, others } = await seedOrgWithRoles('ADMIN', ['OWNER', 'ANALYST']);
      const target = others[1]!; // ANALYST
      const jwt = await mintJwt({
        userId: actor.userId,
        email: actor.email,
        memberships: membershipsClaim([{ id: org.id, slug: org.slug, role: 'ADMIN' }]),
      });

      const res = await fetch(`${baseUrl}/org/${org.id}/members/${target.userId}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${jwt}`,
          'x-org-id': org.id,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ role: 'OWNER' }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe('OWNER_PROMOTE_REQUIRES_OWNER');
    });

    it('R-Membership-Update — last-OWNER demote (sole OWNER → ADMIN) → 409 LAST_OWNER, mv unchanged', async () => {
      const { org, actor } = await seedOrgWithRoles('OWNER');
      const jwt = await mintJwt({
        userId: actor.userId,
        email: actor.email,
        memberships: membershipsClaim([{ id: org.id, slug: org.slug, role: 'OWNER' }]),
      });
      const mvBefore = await readMv(actor.userId);

      const res = await fetch(`${baseUrl}/org/${org.id}/members/${actor.userId}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${jwt}`,
          'x-org-id': org.id,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ role: 'ADMIN' }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe('LAST_OWNER');
      expect(await readMv(actor.userId)).toBe(mvBefore);
    });

    it('R-Membership-Update — empty body / invalid role → 400', async () => {
      const { org, actor } = await seedOrgWithRoles('OWNER');
      const jwt = await mintJwt({
        userId: actor.userId,
        email: actor.email,
        memberships: membershipsClaim([{ id: org.id, slug: org.slug, role: 'OWNER' }]),
      });

      const res = await fetch(`${baseUrl}/org/${org.id}/members/${actor.userId}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${jwt}`,
          'x-org-id': org.id,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ role: 'NOT_A_ROLE' }),
      });
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------- //
  // R-Membership-Remove — DELETE /org/:orgId/members/:userId             //
  // -------------------------------------------------------------------- //

  describe('DELETE /org/:orgId/members/:userId', () => {
    it('R-Membership-Remove — ADMIN removes ANALYST → 204 + row deleted + target mv bumped', async () => {
      const { org, actor, others } = await seedOrgWithRoles('ADMIN', ['ANALYST']);
      const target = others[0]!;
      const jwt = await mintJwt({
        userId: actor.userId,
        email: actor.email,
        memberships: membershipsClaim([{ id: org.id, slug: org.slug, role: 'ADMIN' }]),
      });
      const mvBefore = await readMv(target.userId);

      const res = await fetch(`${baseUrl}/org/${org.id}/members/${target.userId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
      });
      expect(res.status).toBe(204);

      const row = await prisma.membership.findUnique({
        where: { userId_organizationId: { userId: target.userId, organizationId: org.id } },
      });
      expect(row).toBeNull();
      expect(await readMv(target.userId)).toBe(mvBefore + 1);
    });

    it('R-Membership-Remove Q8 — ANALYST self-leave non-personal org → 204', async () => {
      const { org, actor } = await seedOrgWithRoles('ANALYST');
      // Add a second OWNER so the org doesn't trip last-OWNER guard for unrelated runs.
      const owner = await createUser();
      await addMembership(owner.userId, org.id, 'OWNER');
      const jwt = await mintJwt({
        userId: actor.userId,
        email: actor.email,
        memberships: membershipsClaim([{ id: org.id, slug: org.slug, role: 'ANALYST' }]),
      });

      const res = await fetch(`${baseUrl}/org/${org.id}/members/${actor.userId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
      });
      expect(res.status).toBe(204);
    });

    it('R-Membership-Remove — self-leave from personal org → 400 PERSONAL_ORG_UNREMOVABLE', async () => {
      const { org, actor } = await seedOrgWithRoles('OWNER');
      // Need a second OWNER so last-OWNER doesn't trigger first.
      const otherOwner = await createUser();
      await addMembership(otherOwner.userId, org.id, 'OWNER');
      // Mark org as actor's personalOrg.
      await prisma.user.update({
        where: { id: actor.userId },
        data: { personalOrgId: org.id },
      });
      const jwt = await mintJwt({
        userId: actor.userId,
        email: actor.email,
        memberships: membershipsClaim([{ id: org.id, slug: org.slug, role: 'OWNER' }]),
      });

      const res = await fetch(`${baseUrl}/org/${org.id}/members/${actor.userId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe('PERSONAL_ORG_UNREMOVABLE');
    });

    it('R-Membership-Remove — last-OWNER remove (sole OWNER tries to leave) → 409 LAST_OWNER', async () => {
      const { org, actor } = await seedOrgWithRoles('OWNER');
      const jwt = await mintJwt({
        userId: actor.userId,
        email: actor.email,
        memberships: membershipsClaim([{ id: org.id, slug: org.slug, role: 'OWNER' }]),
      });
      const mvBefore = await readMv(actor.userId);

      const res = await fetch(`${baseUrl}/org/${org.id}/members/${actor.userId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe('LAST_OWNER');
      expect(await readMv(actor.userId)).toBe(mvBefore);
    });

    it('R-Membership-Remove — ADMIN removes OWNER (cross-user) → 403 OWNER_REMOVE_REQUIRES_OWNER', async () => {
      const { org, actor, others } = await seedOrgWithRoles('ADMIN', ['OWNER', 'OWNER']);
      const targetOwner = others[0]!;
      const jwt = await mintJwt({
        userId: actor.userId,
        email: actor.email,
        memberships: membershipsClaim([{ id: org.id, slug: org.slug, role: 'ADMIN' }]),
      });

      const res = await fetch(`${baseUrl}/org/${org.id}/members/${targetOwner.userId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe('OWNER_REMOVE_REQUIRES_OWNER');
    });

    it('R-Membership-Remove — VIEWER tries to remove another user → 403 (RolesOrSelf rejects)', async () => {
      const { org, actor, others } = await seedOrgWithRoles('VIEWER', ['ANALYST']);
      const target = others[0]!;
      const jwt = await mintJwt({
        userId: actor.userId,
        email: actor.email,
        memberships: membershipsClaim([{ id: org.id, slug: org.slug, role: 'VIEWER' }]),
      });

      const res = await fetch(`${baseUrl}/org/${org.id}/members/${target.userId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
      });
      expect(res.status).toBe(403);
    });

    it('R-Membership-Remove — no Authorization → 401', async () => {
      const { org, actor } = await seedOrgWithRoles('OWNER');
      const res = await fetch(`${baseUrl}/org/${org.id}/members/${actor.userId}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(401);
    });

    it('R-Jwt-Invalidate-Cross-User — stale mv on PATCH → 401 STALE_MEMBERSHIPS', async () => {
      const { org, actor, others } = await seedOrgWithRoles('OWNER', ['ANALYST']);
      const target = others[0]!;
      // Bump actor's mv server-side so the JWT (mv=0) is stale.
      await prisma.user.update({
        where: { id: actor.userId },
        data: { membershipsVersion: { increment: 1 } },
      });
      const jwt = await mintJwt({
        userId: actor.userId,
        email: actor.email,
        memberships: membershipsClaim([{ id: org.id, slug: org.slug, role: 'OWNER' }]),
        mv: 0,
      });

      const res = await fetch(`${baseUrl}/org/${org.id}/members/${target.userId}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${jwt}`,
          'x-org-id': org.id,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ role: 'VIEWER' }),
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe('STALE_MEMBERSHIPS');
    });
  });
});
