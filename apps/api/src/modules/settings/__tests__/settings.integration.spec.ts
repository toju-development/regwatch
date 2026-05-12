import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { type INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@regwatch/db/client';
import {
  SETTINGS_UPDATED_EVENT,
  type MembershipClaim,
  type Role,
  type SettingsUpdatedEvent,
  type UpdateSettingsInput,
} from '@regwatch/types';
import { AppModule } from '../../../app.module.js';

/**
 * HTTP integration tests for `SettingsController` — boots the full
 * `AppModule` (including the global guard chain
 * `JwtAuthGuard` → `MembershipFreshnessGuard` → `OrgScopeGuard` →
 * `RolesGuard`) against a real Postgres instance and exercises every
 * endpoint end-to-end via `fetch`.
 *
 * Spec: `sdd/jurisdictions-config/spec`
 *   - R-Settings-Get-Or-Create
 *   - R-Settings-Update
 *   - R-Settings-Race-Safe
 *   - R-Settings-Validation
 *   - R-Settings-Updated-Event
 * Design: `sdd/jurisdictions-config/design` §0 D6/D8/D13, §2, §6.
 *
 * ## Why bare `/org/...` paths
 *
 * `apps/api/src/main.ts` does NOT call `setGlobalPrefix('api')` — see
 * discovery `apps-api-no-global-prefix`. The `/api/org/...` URL shape
 * lives at the WEB layer (PROXY MODE #666).
 *
 * ## DB skip-if-unreachable
 *
 * Mirrors `members.integration.spec.ts` — skipped when local Postgres
 * at `regwatch_dev` is unreachable. CI with a Postgres service still runs.
 *
 * ## Foot-gun #687: scoped reads only
 *
 * NEVER do `prisma.settings.count()` — vitest runs spec files in
 * parallel against the SAME `regwatch_dev` database, so global counts
 * see deltas from sibling specs in flight. All reads are scoped to a
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

const VALID_BODY: UpdateSettingsInput = {
  jurisdictions: [
    { code: 'AR', enabled: true, customTopics: 'fintech' },
    { code: 'BR', enabled: false, customTopics: '' },
  ],
  scanSchedule: 'daily',
  scanDay: 'mon',
  scanHour: 14,
};

describe.skipIf(!dbAvailable)('SettingsController (HTTP integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let prisma: PrismaClient;
  let events: EventEmitter2;
  const createdUserIds = new Set<string>();
  const createdOrgIds = new Set<string>();
  let captured: SettingsUpdatedEvent[] = [];
  const captureListener = (evt: SettingsUpdatedEvent): void => {
    captured.push(evt);
  };

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
    events = app.get(EventEmitter2);
    events.on(SETTINGS_UPDATED_EVENT, captureListener);
  });

  beforeEach(() => {
    captured = [];
  });

  afterAll(async () => {
    events.off(SETTINGS_UPDATED_EVENT, captureListener);
    if (createdOrgIds.size > 0) {
      // Settings cascade-delete via FK onDelete: Cascade — so dropping
      // orgs takes the rows with them. Memberships go the same way.
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
    const userId = `int-set-${tag}`;
    const email = `${userId}@test.local`;
    createdUserIds.add(userId);
    await prisma.user.create({ data: { id: userId, email } });
    return { userId, email };
  }

  async function createOrg(): Promise<{ id: string; slug: string; name: string }> {
    const tag = randomBytes(6).toString('hex');
    const slug = `int-set-${tag}`;
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

  // ------------------------------------------------------------------ //
  // GET /org/:orgId/settings — R-Settings-Get-Or-Create                //
  // ------------------------------------------------------------------ //

  describe('GET /org/:orgId/settings', () => {
    it('cold-creates the row with 9-LatAm defaults (weekly/mon/8) on first GET', async () => {
      const { org, actor } = await seed('VIEWER');
      const jwt = await getJwt(actor, org, 'VIEWER');

      const res = await fetch(`${baseUrl}/org/${org.id}/settings`, {
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = (await res.json()) as {
        settings: {
          jurisdictions: Array<{ code: string; enabled: boolean }>;
          scanSchedule: string;
          scanDay: string;
          scanHour: number;
          updatedAt: string;
        };
      };
      expect(body.settings.jurisdictions.map((j) => j.code).sort()).toEqual(
        ['AR', 'BR', 'CL', 'CO', 'EC', 'MX', 'PA', 'PE', 'UY'].sort(),
      );
      expect(body.settings.jurisdictions.every((j) => j.enabled)).toBe(true);
      expect(body.settings.scanSchedule).toBe('weekly');
      expect(body.settings.scanDay).toBe('mon');
      expect(body.settings.scanHour).toBe(8);
      expect(() => new Date(body.settings.updatedAt).toISOString()).not.toThrow();

      // Scoped read — exactly one row exists for THIS org (foot-gun #687).
      const rows = await prisma.settings.findMany({ where: { organizationId: org.id } });
      expect(rows).toHaveLength(1);
    });

    it('warm GET returns the persisted row unchanged (same updatedAt)', async () => {
      const { org, actor } = await seed('OWNER');
      const jwt = await getJwt(actor, org, 'OWNER');
      const first = await fetch(`${baseUrl}/org/${org.id}/settings`, {
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
      });
      const firstBody = (await first.json()) as { settings: { updatedAt: string } };
      const second = await fetch(`${baseUrl}/org/${org.id}/settings`, {
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
      });
      const secondBody = (await second.json()) as { settings: { updatedAt: string } };
      expect(secondBody.settings.updatedAt).toBe(firstBody.settings.updatedAt);
    });

    it('R-Settings-Race-Safe — 5 concurrent first-GETs converge on EXACTLY 1 row', async () => {
      const { org, actor } = await seed('OWNER');
      const jwt = await getJwt(actor, org, 'OWNER');
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          fetch(`${baseUrl}/org/${org.id}/settings`, {
            headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
          }),
        ),
      );
      for (const r of responses) expect(r.status).toBe(200);
      const rows = await prisma.settings.findMany({ where: { organizationId: org.id } });
      expect(rows).toHaveLength(1);
    });

    it.each<[Role]>([['OWNER'], ['ADMIN'], ['ANALYST'], ['VIEWER']])(
      'role %s — any member may read (no @Roles on GET)',
      async (role) => {
        const { org, actor } = await seed(role);
        const jwt = await getJwt(actor, org, role);
        const res = await fetch(`${baseUrl}/org/${org.id}/settings`, {
          headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
        });
        expect(res.status).toBe(200);
      },
    );

    it('non-member → 403 (OrgScopeGuard) and NO row created', async () => {
      const orgA = await createOrg();
      const { actor, org: orgOwn } = await seed('OWNER');
      // Caller is member of orgOwn but hits orgA via X-Org-Id mismatch.
      const jwt = await getJwt(actor, orgOwn, 'OWNER');
      const res = await fetch(`${baseUrl}/org/${orgA.id}/settings`, {
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': orgA.id },
      });
      expect(res.status).toBe(403);
      const rows = await prisma.settings.findMany({ where: { organizationId: orgA.id } });
      expect(rows).toHaveLength(0);
    });

    it('anonymous → 401', async () => {
      const { org } = await seed('OWNER');
      const res = await fetch(`${baseUrl}/org/${org.id}/settings`);
      expect(res.status).toBe(401);
    });

    it('stale mv → 401 STALE_MEMBERSHIPS', async () => {
      const { org, actor } = await seed('OWNER');
      // Server-side bump invalidates the JWT (mv=0).
      await prisma.user.update({
        where: { id: actor.userId },
        data: { membershipsVersion: { increment: 1 } },
      });
      const jwt = await getJwt(actor, org, 'OWNER', { mv: 0 });
      const res = await fetch(`${baseUrl}/org/${org.id}/settings`, {
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe('STALE_MEMBERSHIPS');
    });
  });

  // ------------------------------------------------------------------ //
  // PUT /org/:orgId/settings — R-Settings-Update + R-Settings-Updated  //
  // ------------------------------------------------------------------ //

  describe('PUT /org/:orgId/settings', () => {
    it('OWNER PUT — 200, DB matches body, event emitted exactly once with actorId', async () => {
      const { org, actor } = await seed('OWNER');
      const jwt = await getJwt(actor, org, 'OWNER');

      const res = await fetch(`${baseUrl}/org/${org.id}/settings`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${jwt}`,
          'x-org-id': org.id,
          'content-type': 'application/json',
        },
        body: JSON.stringify(VALID_BODY),
      });
      expect(res.status).toBe(200);
      const row = await prisma.settings.findUniqueOrThrow({
        where: { organizationId: org.id },
      });
      expect(row.scanSchedule).toBe('daily');
      expect(row.scanDay).toBe('mon');
      expect(row.scanHour).toBe(14);
      expect(row.jurisdictions).toEqual(VALID_BODY.jurisdictions);

      expect(captured).toHaveLength(1);
      expect(captured[0]?.organizationId).toBe(org.id);
      expect(captured[0]?.actorId).toBe(actor.userId);
      expect(captured[0]?.scanHour).toBe(14);
    });

    it('PUT lazily creates the row when no prior GET (upsert path)', async () => {
      const { org, actor } = await seed('ADMIN');
      const jwt = await getJwt(actor, org, 'ADMIN');
      // Confirm no row pre-exists.
      const before = await prisma.settings.findMany({ where: { organizationId: org.id } });
      expect(before).toHaveLength(0);

      const res = await fetch(`${baseUrl}/org/${org.id}/settings`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${jwt}`,
          'x-org-id': org.id,
          'content-type': 'application/json',
        },
        body: JSON.stringify(VALID_BODY),
      });
      expect(res.status).toBe(200);
      const after = await prisma.settings.findUniqueOrThrow({
        where: { organizationId: org.id },
      });
      expect(after.scanHour).toBe(14);
    });

    it.each<[Role, number, boolean]>([
      ['OWNER', 200, true],
      ['ADMIN', 200, true],
      ['ANALYST', 403, false],
      ['VIEWER', 403, false],
    ])('role matrix — %s → %d (event emitted: %s)', async (role, expectedStatus, expectEvent) => {
      const { org, actor } = await seed(role);
      const jwt = await getJwt(actor, org, role);
      const res = await fetch(`${baseUrl}/org/${org.id}/settings`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${jwt}`,
          'x-org-id': org.id,
          'content-type': 'application/json',
        },
        body: JSON.stringify(VALID_BODY),
      });
      expect(res.status).toBe(expectedStatus);
      if (expectEvent) {
        expect(captured.some((e) => e.organizationId === org.id)).toBe(true);
      } else {
        expect(captured.some((e) => e.organizationId === org.id)).toBe(false);
      }
    });

    it.each<[string, unknown]>([
      ['empty jurisdictions', { ...VALID_BODY, jurisdictions: [] }],
      [
        'no enabled jurisdiction',
        {
          ...VALID_BODY,
          jurisdictions: [{ code: 'AR', enabled: false, customTopics: '' }],
        },
      ],
      [
        'duplicate code',
        {
          ...VALID_BODY,
          jurisdictions: [
            { code: 'AR', enabled: true, customTopics: '' },
            { code: 'AR', enabled: false, customTopics: '' },
          ],
        },
      ],
      ['weekly + multi-day', { ...VALID_BODY, scanSchedule: 'weekly', scanDay: 'mon,tue' }],
    ])('R-Settings-Validation — %s → 400, no event, no DB mutation', async (_label, body) => {
      const { org, actor } = await seed('OWNER');
      const jwt = await getJwt(actor, org, 'OWNER');
      const res = await fetch(`${baseUrl}/org/${org.id}/settings`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${jwt}`,
          'x-org-id': org.id,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      expect(captured.some((e) => e.organizationId === org.id)).toBe(false);
      // Scoped read — no row written for this org (foot-gun #687).
      const rows = await prisma.settings.findMany({ where: { organizationId: org.id } });
      expect(rows).toHaveLength(0);
    });

    it('R-Settings-Updated-Event POST-commit — throwing listener does NOT roll back the row', async () => {
      const { org, actor } = await seed('OWNER');
      const jwt = await getJwt(actor, org, 'OWNER');
      const throwing = (): void => {
        throw new Error('downstream blew up');
      };
      events.on(SETTINGS_UPDATED_EVENT, throwing);
      try {
        const res = await fetch(`${baseUrl}/org/${org.id}/settings`, {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${jwt}`,
            'x-org-id': org.id,
            'content-type': 'application/json',
          },
          body: JSON.stringify(VALID_BODY),
        });
        expect(res.status).toBe(200);
        // Row IS persisted despite the listener throw — D13 guarantee.
        const row = await prisma.settings.findUniqueOrThrow({
          where: { organizationId: org.id },
        });
        expect(row.scanHour).toBe(14);
      } finally {
        events.off(SETTINGS_UPDATED_EVENT, throwing);
      }
    });

    // ------------------------------------------------------------------ //
    // PATCH /org/:orgId/settings — MVP-11 onboarding completion          //
    // ------------------------------------------------------------------ //

    // Note: nested inside the PUT describe intentionally — the helper
    // functions (seed, getJwt, etc.) are shared. A separate top-level
    // describe would require duplicating them.

    describe('PATCH /org/:orgId/settings — completeOnboarding', () => {
      const PATCH_BODY = { onboardingCompletedAt: '2026-05-09T10:00:00.000Z' };

      it('OWNER PATCH — 200, DB row has onboardingCompletedAt set', async () => {
        const { org, actor } = await seed('OWNER');
        const jwt = await getJwt(actor, org, 'OWNER');

        // Ensure the settings row exists (PATCH uses UPDATE, not upsert).
        await fetch(`${baseUrl}/org/${org.id}/settings`, {
          headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
        });

        const res = await fetch(`${baseUrl}/org/${org.id}/settings`, {
          method: 'PATCH',
          headers: {
            authorization: `Bearer ${jwt}`,
            'x-org-id': org.id,
            'content-type': 'application/json',
          },
          body: JSON.stringify(PATCH_BODY),
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as { settings: { onboardingCompletedAt: string | null } };
        expect(body.settings.onboardingCompletedAt).toBe(PATCH_BODY.onboardingCompletedAt);

        const row = await prisma.settings.findUniqueOrThrow({
          where: { organizationId: org.id },
        });
        expect(row.onboardingCompletedAt?.toISOString()).toBe(PATCH_BODY.onboardingCompletedAt);
      });

      it.each<[Role]>([['ADMIN'], ['ANALYST'], ['VIEWER']])(
        'role %s → 403 (OWNER-only endpoint)',
        async (role) => {
          const { org, actor } = await seed(role);
          const jwt = await getJwt(actor, org, role);
          const res = await fetch(`${baseUrl}/org/${org.id}/settings`, {
            method: 'PATCH',
            headers: {
              authorization: `Bearer ${jwt}`,
              'x-org-id': org.id,
              'content-type': 'application/json',
            },
            body: JSON.stringify(PATCH_BODY),
          });
          expect(res.status).toBe(403);
        },
      );

      it('invalid body (bad datetime format) → 400', async () => {
        const { org, actor } = await seed('OWNER');
        const jwt = await getJwt(actor, org, 'OWNER');
        // Ensure row exists.
        await fetch(`${baseUrl}/org/${org.id}/settings`, {
          headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
        });
        const res = await fetch(`${baseUrl}/org/${org.id}/settings`, {
          method: 'PATCH',
          headers: {
            authorization: `Bearer ${jwt}`,
            'x-org-id': org.id,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ onboardingCompletedAt: 'not-a-datetime' }),
        });
        expect(res.status).toBe(400);
      });
    });

    it('MVP-12 — PUT with scanSchedule=monthly and scanDayOfMonth persists correctly', async () => {
      const { org, actor } = await seed('OWNER');
      const jwt = await getJwt(actor, org, 'OWNER');

      const body: UpdateSettingsInput = {
        jurisdictions: [{ code: 'AR', enabled: true, customTopics: '' }],
        scanSchedule: 'monthly',
        scanDay: 'mon',
        scanHour: 8,
        scanDayOfMonth: 15,
      };

      const res = await fetch(`${baseUrl}/org/${org.id}/settings`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${jwt}`,
          'x-org-id': org.id,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);

      const row = await prisma.settings.findUniqueOrThrow({
        where: { organizationId: org.id },
      });
      expect(row.scanSchedule).toBe('monthly');
      expect(row.scanDayOfMonth).toBe(15);
    });

    it('MVP-12 — PUT with scanSchedule=monthly and no scanDayOfMonth → defaults to 1 in DB', async () => {
      const { org, actor } = await seed('OWNER');
      const jwt = await getJwt(actor, org, 'OWNER');

      const body: UpdateSettingsInput = {
        jurisdictions: [{ code: 'AR', enabled: true, customTopics: '' }],
        scanSchedule: 'monthly',
        scanDay: 'mon',
        scanHour: 6,
        // scanDayOfMonth omitted — should default to 1
      };

      const res = await fetch(`${baseUrl}/org/${org.id}/settings`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${jwt}`,
          'x-org-id': org.id,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);

      const row = await prisma.settings.findUniqueOrThrow({
        where: { organizationId: org.id },
      });
      expect(row.scanSchedule).toBe('monthly');
      expect(row.scanDayOfMonth).toBe(1); // DB default
    });

    it('cascade-on-org-delete (migration #6) — Settings row drops with the org', async () => {
      const { org, actor } = await seed('OWNER');
      const jwt = await getJwt(actor, org, 'OWNER');
      // Lazy-create the row.
      await fetch(`${baseUrl}/org/${org.id}/settings`, {
        headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
      });
      const before = await prisma.settings.findMany({ where: { organizationId: org.id } });
      expect(before).toHaveLength(1);

      // Detach personalOrg refs first to avoid FK violations on user updates,
      // then drop the org. ON DELETE CASCADE on Settings.organizationId fires.
      await prisma.user.updateMany({
        where: { id: actor.userId },
        data: { personalOrgId: null },
      });
      await prisma.membership.deleteMany({ where: { organizationId: org.id } });
      await prisma.organization.delete({ where: { id: org.id } });
      createdOrgIds.delete(org.id); // Already deleted; skip in afterAll.

      const after = await prisma.settings.findMany({ where: { organizationId: org.id } });
      expect(after).toHaveLength(0);
    });
  });
});
