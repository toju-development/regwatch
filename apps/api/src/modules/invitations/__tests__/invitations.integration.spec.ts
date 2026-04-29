import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaClient } from '@regwatch/db/client';
import type { AuthUser, Role } from '@regwatch/types';
import { AppModule } from '../../../app.module.js';
import { InvitationsService } from '../invitations.service.js';
import { MembersService } from '../../members/members.service.js';
import { INVITATION_CREATED_EVENT } from '../../email/events/invitation-created.event.js';

/**
 * Service-level integration tests for `InvitationsService` (B4 — no HTTP
 * controller yet; B5 lands `InvitationsController`).
 *
 * Spec: `sdd/org-invitations/spec` R-Invitation-Issue, R-Invitation-Accept,
 *   R-Invitation-Revoke, R-Invitation-Preview, R-Invitations-List.
 * Design: `sdd/org-invitations/design` §0 #1-#3 (architectural chokepoint),
 *   D3 (post-commit emit), D8 (computed status).
 *
 * ## Why service-level (not HTTP)
 *
 * B4 ships the service+repo+module without a controller — the routing
 * layer (`POST /org/:orgId/invitations`, `POST /accept/:token`, …) is
 * deliberately deferred to B5 so this batch stays scoped. The integration
 * tests still boot the real `AppModule` (real DI graph, real Postgres,
 * real `EventEmitter2` post-commit listener) and call `InvitationsService`
 * directly. The HTTP guard chain + the JSON `code` body envelope land in
 * B5 with their own integration spec.
 *
 * ## Architectural chokepoint guard (R1 HIGH)
 *
 * The accept happy-path test installs a `vi.spyOn(members, 'createOrGet')`
 * and asserts the call: `InvitationsService` MUST go through
 * `MembersService.createOrGet` for every Membership INSERT. A future
 * regression that reaches `prisma.membership.create` directly would
 * silently bypass the `User.membershipsVersion++` invariant.
 *
 * ## DB skip-if-unreachable
 *
 * Same probe pattern as `members.integration.spec.ts` — skipped locally
 * when Postgres at `regwatch_dev` is unreachable; CI's Postgres service
 * still runs.
 *
 * ## Foot-gun #687 — scoped reads only
 *
 * Vitest runs spec files in parallel against the SAME `regwatch_dev`
 * database. Every read is scoped to a seeded id/email/orgId — never a
 * raw `prisma.invitation.count()`.
 */

const PLACEHOLDER_DB_URL = 'postgresql://test:test@localhost:5432/test';
if (!process.env.DATABASE_URL || process.env.DATABASE_URL === PLACEHOLDER_DB_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:root@localhost:5432/regwatch_dev?schema=public';
}
const AUTH_SECRET = process.env.AUTH_SECRET ?? 'test-auth-secret-must-be-at-least-32-chars-ok';
process.env.AUTH_SECRET = AUTH_SECRET;
// Memory adapter so EmailListener consumes invitation.created events
// without touching real SMTP/Resend.
process.env.EMAIL_TRANSPORT = process.env.EMAIL_TRANSPORT ?? 'memory';

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

describe.skipIf(!dbAvailable)('InvitationsService (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let invitations: InvitationsService;
  let members: MembersService;
  let events: EventEmitter2;

  const createdUserIds = new Set<string>();
  const createdOrgIds = new Set<string>();
  const createdInvitationIds = new Set<string>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new PrismaClient();
    invitations = app.get(InvitationsService);
    members = app.get(MembersService);
    events = app.get(EventEmitter2);
  });

  afterAll(async () => {
    if (createdInvitationIds.size > 0) {
      await prisma.invitation.deleteMany({
        where: { id: { in: [...createdInvitationIds] } },
      });
    }
    if (createdUserIds.size > 0) {
      await prisma.membership.deleteMany({
        where: { userId: { in: [...createdUserIds] } },
      });
    }
    if (createdOrgIds.size > 0) {
      await prisma.invitation.deleteMany({
        where: { organizationId: { in: [...createdOrgIds] } },
      });
      await prisma.membership.deleteMany({
        where: { organizationId: { in: [...createdOrgIds] } },
      });
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

  // ------------------------------------------------------------------ //
  // Helpers                                                            //
  // ------------------------------------------------------------------ //

  function tag(): string {
    return randomBytes(6).toString('hex');
  }

  async function createUser(opts?: {
    name?: string | null;
    email?: string;
  }): Promise<{ userId: string; email: string }> {
    const t = tag();
    const userId = `int-inv-${t}`;
    const email = opts?.email ?? `${userId}@test.local`;
    createdUserIds.add(userId);
    await prisma.user.create({
      data: {
        id: userId,
        email,
        name: opts?.name === undefined ? `User ${t}` : opts.name,
      },
    });
    return { userId, email };
  }

  async function createOrg(): Promise<{ id: string; slug: string; name: string }> {
    const t = tag();
    const slug = `int-inv-${t}`;
    const org = await prisma.organization.create({
      data: { slug, name: `Org ${t}` },
      select: { id: true, slug: true, name: true },
    });
    createdOrgIds.add(org.id);
    return org;
  }

  async function addMembership(userId: string, orgId: string, role: Role): Promise<void> {
    await prisma.membership.create({
      data: { userId, organizationId: orgId, role },
    });
  }

  function makeActor(opts: {
    userId: string;
    email: string;
    orgs: Array<{ id: string; slug: string; role: Role }>;
  }): AuthUser {
    return {
      userId: opts.userId,
      email: opts.email,
      memberships: opts.orgs.map((o) => ({
        organizationId: o.id,
        orgSlug: o.slug,
        role: o.role,
      })),
    };
  }

  /**
   * Seed an org with a single OWNER actor. The actor is created with
   * `name` set so `inviterName` on the emitted event is non-null.
   */
  async function seedOrgWithOwner(): Promise<{
    org: { id: string; slug: string; name: string };
    owner: { userId: string; email: string };
    actor: AuthUser;
  }> {
    const org = await createOrg();
    const owner = await createUser();
    await addMembership(owner.userId, org.id, 'OWNER');
    const actor = makeActor({
      userId: owner.userId,
      email: owner.email,
      orgs: [{ id: org.id, slug: org.slug, role: 'OWNER' }],
    });
    return { org, owner, actor };
  }

  function trackInvitation(id: string): string {
    createdInvitationIds.add(id);
    return id;
  }

  function captureNextEvent(): Promise<unknown> {
    return new Promise((resolve) => {
      events.once(INVITATION_CREATED_EVENT, (payload) => resolve(payload));
    });
  }

  // ------------------------------------------------------------------ //
  // R-Invitation-Issue                                                 //
  // ------------------------------------------------------------------ //

  describe('issue', () => {
    it('happy path — INSERT pending row, emits invitation.created event with acceptUrl', async () => {
      const { org, owner, actor } = await seedOrgWithOwner();
      const inviteeEmail = `invitee-${tag()}@example.com`;
      const eventP = captureNextEvent();

      const res = await invitations.issue(actor, org.id, {
        email: inviteeEmail,
        role: 'ANALYST',
      });
      trackInvitation(res.id);

      expect(res.email).toBe(inviteeEmail.toLowerCase());
      expect(res.role).toBe('ANALYST');
      expect(res.status).toBe('PENDING');
      expect(res.invitedById).toBe(owner.userId);
      expect(res.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Row scoped to seeded id (#687).
      const row = await prisma.invitation.findUniqueOrThrow({ where: { id: res.id } });
      expect(row.email).toBe(inviteeEmail.toLowerCase());
      expect(row.role).toBe('ANALYST');
      expect(row.acceptedAt).toBeNull();
      expect(row.revokedAt).toBeNull();
      expect(row.token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(row.invitedById).toBe(owner.userId);

      // Event emitted post-commit with a fully-qualified acceptUrl.
      const evt = (await eventP) as {
        to: string;
        orgName: string;
        inviterName: string | null;
        role: Role;
        acceptUrl: string;
        expiresAt: Date;
      };
      expect(evt.to).toBe(inviteeEmail.toLowerCase());
      expect(evt.orgName).toBe(org.name);
      expect(evt.role).toBe('ANALYST');
      expect(evt.acceptUrl).toBe(`http://localhost:3000/accept/${row.token}`);
    });

    it('re-issue — REPLACE pending row (rotates token, extends expiry, updates invitedById)', async () => {
      const { org, owner, actor } = await seedOrgWithOwner();
      const inviteeEmail = `re-${tag()}@example.com`;
      const first = await invitations.issue(actor, org.id, {
        email: inviteeEmail,
        role: 'ANALYST',
      });
      trackInvitation(first.id);
      const firstRow = await prisma.invitation.findUniqueOrThrow({ where: { id: first.id } });
      const firstToken = firstRow.token;
      const firstExpiry = firstRow.expiresAt;
      // Different inviter for the re-issue — assert invitedById updates.
      const second = await createUser();
      await addMembership(second.userId, org.id, 'OWNER');
      const secondActor = makeActor({
        userId: second.userId,
        email: second.email,
        orgs: [{ id: org.id, slug: org.slug, role: 'OWNER' }],
      });

      // Pause one ms so expiresAt strictly differs.
      await new Promise((r) => setTimeout(r, 5));

      const reissued = await invitations.issue(secondActor, org.id, {
        email: inviteeEmail,
        role: 'ANALYST',
      });

      // Same id (REPLACE, not INSERT).
      expect(reissued.id).toBe(first.id);
      const replaced = await prisma.invitation.findUniqueOrThrow({ where: { id: first.id } });
      expect(replaced.token).not.toBe(firstToken);
      expect(replaced.expiresAt.getTime()).toBeGreaterThan(firstExpiry.getTime());
      expect(replaced.invitedById).toBe(second.userId);
      // Originally created by `owner`; now reissued by `second` — invitedById moved.
      expect(replaced.invitedById).not.toBe(owner.userId);
    });

    it('ALREADY_MEMBER — accepted row exists for (orgId, email) → 409', async () => {
      const { org, actor } = await seedOrgWithOwner();
      const inviteeEmail = `already-${tag()}@example.com`;
      // Seed a previously-accepted invitation for the same (orgId, email).
      const acceptedRow = await prisma.invitation.create({
        data: {
          organizationId: org.id,
          email: inviteeEmail.toLowerCase(),
          role: 'VIEWER',
          token: `seed-tok-${tag()}`,
          expiresAt: new Date(Date.now() + 7 * 86400000),
          acceptedAt: new Date(),
        },
      });
      trackInvitation(acceptedRow.id);

      await expect(
        invitations.issue(actor, org.id, { email: inviteeEmail, role: 'ANALYST' }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'ALREADY_MEMBER' },
      });
    });

    it('PERSONAL_ORG_NOT_INVITABLE — actor invites into their own personal org → 400', async () => {
      const { org, owner, actor } = await seedOrgWithOwner();
      await prisma.user.update({
        where: { id: owner.userId },
        data: { personalOrgId: org.id },
      });
      await expect(
        invitations.issue(actor, org.id, {
          email: `nope-${tag()}@example.com`,
          role: 'VIEWER',
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: 'PERSONAL_ORG_NOT_INVITABLE' },
      });
    });

    it('OWNER_INVITE_REQUIRES_OWNER — ADMIN cannot mint OWNER → 403', async () => {
      const org = await createOrg();
      const adminUser = await createUser();
      await addMembership(adminUser.userId, org.id, 'ADMIN');
      const actor = makeActor({
        userId: adminUser.userId,
        email: adminUser.email,
        orgs: [{ id: org.id, slug: org.slug, role: 'ADMIN' }],
      });

      await expect(
        invitations.issue(actor, org.id, {
          email: `power-${tag()}@example.com`,
          role: 'OWNER',
        }),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'OWNER_INVITE_REQUIRES_OWNER' },
      });
    });

    it('INVALID_EMAIL → 400 with structured code', async () => {
      const { org, actor } = await seedOrgWithOwner();
      await expect(
        invitations.issue(actor, org.id, { email: 'not-an-email', role: 'VIEWER' }),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: 'INVALID_EMAIL' },
      });
    });

    it('INVALID_ROLE → 400 with structured code', async () => {
      const { org, actor } = await seedOrgWithOwner();
      await expect(
        invitations.issue(actor, org.id, {
          email: `ok-${tag()}@example.com`,
          role: 'NOT_A_ROLE',
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: 'INVALID_ROLE' },
      });
    });

    it('INVALID_EMAIL → 400 when email exceeds 254 chars (DB column cap, not a 500)', async () => {
      // Regression: `Invitation.email` is `@db.VarChar(254)`. Pre-fix, a
      // 255+ char string passed the regex and exploded at the DB layer
      // with a 500. The service-level length guard catches it as 400
      // INVALID_EMAIL — same structured code as a malformed address.
      const { org, actor } = await seedOrgWithOwner();
      const longLocal = 'a'.repeat(250);
      const oversized = `${longLocal}@e.io`; // 250 + 5 = 255 chars
      expect(oversized.length).toBe(255);
      await expect(
        invitations.issue(actor, org.id, { email: oversized, role: 'VIEWER' }),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: 'INVALID_EMAIL' },
      });
    });

    it('trims surrounding whitespace before validating + persisting email', async () => {
      // Defensive: callers occasionally paste `" foo@bar.baz "`. Trim
      // BEFORE the regex/length checks AND store the trimmed-lowercase
      // form so downstream EMAIL_MISMATCH compares cleanly.
      const { org, actor } = await seedOrgWithOwner();
      const cleanEmail = `trim-${tag()}@example.com`;
      const issued = await invitations.issue(actor, org.id, {
        email: `   ${cleanEmail}   `,
        role: 'VIEWER',
      });
      trackInvitation(issued.id);
      expect(issued.email).toBe(cleanEmail.toLowerCase());
      const row = await prisma.invitation.findUniqueOrThrow({ where: { id: issued.id } });
      expect(row.email).toBe(cleanEmail.toLowerCase());
    });

    it('emits acceptUrl with single `/accept/` segment regardless of WEB_URL trailing slash', async () => {
      // Regression: previously built via template-literal concatenation
      // — `${webUrl}/accept/${token}` — which produces `//accept/` when
      // WEB_URL has a trailing slash. The URL constructor canonicalises
      // the join (base origin + new path).
      const { org, actor } = await seedOrgWithOwner();
      const inviteeEmail = `urljoin-${tag()}@example.com`;
      const eventP = captureNextEvent();
      const issued = await invitations.issue(actor, org.id, {
        email: inviteeEmail,
        role: 'VIEWER',
      });
      trackInvitation(issued.id);
      const evt = (await eventP) as { acceptUrl: string };
      // Exactly ONE `/accept/` segment, never `//accept/`.
      expect(evt.acceptUrl).not.toMatch(/\/\/accept\//);
      expect(evt.acceptUrl.match(/\/accept\//g)?.length).toBe(1);
    });
  });

  // ------------------------------------------------------------------ //
  // R-Invitation-Accept (chokepoint)                                   //
  // ------------------------------------------------------------------ //

  describe('accept', () => {
    it('happy path — INSERTs Membership via MembersService.createOrGet (chokepoint guard) + marks acceptedAt', async () => {
      const { org, actor } = await seedOrgWithOwner();
      const invitee = await createUser();
      const issued = await invitations.issue(actor, org.id, {
        email: invitee.email,
        role: 'ANALYST',
      });
      trackInvitation(issued.id);
      const row = await prisma.invitation.findUniqueOrThrow({ where: { id: issued.id } });

      // Architectural assertion (R1 HIGH): every Membership INSERT in
      // the accept path MUST go through MembersService.createOrGet. A
      // bypass to prisma.membership.create would skip the mv++ bump.
      const spy = vi.spyOn(members, 'createOrGet');

      const inviteeAuth: AuthUser = {
        userId: invitee.userId,
        email: invitee.email,
        memberships: [],
      };
      const result = await invitations.accept(inviteeAuth, row.token);

      expect(result.orgId).toBe(org.id);
      expect(result.role).toBe('ANALYST');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({
        userId: invitee.userId,
        organizationId: org.id,
        role: 'ANALYST',
      });
      spy.mockRestore();

      // Membership row exists (scoped read).
      const m = await prisma.membership.findUniqueOrThrow({
        where: {
          userId_organizationId: {
            userId: invitee.userId,
            organizationId: org.id,
          },
        },
      });
      expect(m.role).toBe('ANALYST');

      // Invitation marked accepted.
      const after = await prisma.invitation.findUniqueOrThrow({ where: { id: issued.id } });
      expect(after.acceptedAt).not.toBeNull();
    });

    it('idempotent re-accept by original user — does NOT remark acceptedAt, does NOT bump mv', async () => {
      const { org, actor } = await seedOrgWithOwner();
      const invitee = await createUser();
      const issued = await invitations.issue(actor, org.id, {
        email: invitee.email,
        role: 'VIEWER',
      });
      trackInvitation(issued.id);
      const row = await prisma.invitation.findUniqueOrThrow({ where: { id: issued.id } });
      const inviteeAuth: AuthUser = {
        userId: invitee.userId,
        email: invitee.email,
        memberships: [],
      };
      await invitations.accept(inviteeAuth, row.token);
      const acceptedAtFirst = (
        await prisma.invitation.findUniqueOrThrow({ where: { id: issued.id } })
      ).acceptedAt;
      const mvAfterFirst = (
        await prisma.user.findUniqueOrThrow({
          where: { id: invitee.userId },
          select: { membershipsVersion: true },
        })
      ).membershipsVersion;

      // Second accept by same user — falls through ACCEPTED+has-membership.
      await invitations.accept(inviteeAuth, row.token);

      const after = await prisma.invitation.findUniqueOrThrow({ where: { id: issued.id } });
      expect(after.acceptedAt?.getTime()).toBe(acceptedAtFirst?.getTime());
      const mvAfterSecond = (
        await prisma.user.findUniqueOrThrow({
          where: { id: invitee.userId },
          select: { membershipsVersion: true },
        })
      ).membershipsVersion;
      expect(mvAfterSecond).toBe(mvAfterFirst);
    });

    it('EMAIL_MISMATCH — caller email differs from invitation email → 403', async () => {
      const { org, actor } = await seedOrgWithOwner();
      const issued = await invitations.issue(actor, org.id, {
        email: `target-${tag()}@example.com`,
        role: 'VIEWER',
      });
      trackInvitation(issued.id);
      const row = await prisma.invitation.findUniqueOrThrow({ where: { id: issued.id } });
      const wrongUser = await createUser({ email: `wrong-${tag()}@example.com` });

      await expect(
        invitations.accept(
          { userId: wrongUser.userId, email: wrongUser.email, memberships: [] },
          row.token,
        ),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'EMAIL_MISMATCH' },
      });
    });

    it('REVOKED → 410 INVITATION_REVOKED', async () => {
      const { org, actor } = await seedOrgWithOwner();
      const invitee = await createUser();
      const issued = await invitations.issue(actor, org.id, {
        email: invitee.email,
        role: 'VIEWER',
      });
      trackInvitation(issued.id);
      const row = await prisma.invitation.findUniqueOrThrow({ where: { id: issued.id } });
      await prisma.invitation.update({
        where: { id: issued.id },
        data: { revokedAt: new Date() },
      });

      await expect(
        invitations.accept(
          { userId: invitee.userId, email: invitee.email, memberships: [] },
          row.token,
        ),
      ).rejects.toMatchObject({
        status: 410,
        response: { code: 'INVITATION_REVOKED' },
      });
    });

    it('EXPIRED → 410 INVITATION_EXPIRED', async () => {
      const { org, actor } = await seedOrgWithOwner();
      const invitee = await createUser();
      const issued = await invitations.issue(actor, org.id, {
        email: invitee.email,
        role: 'VIEWER',
      });
      trackInvitation(issued.id);
      const row = await prisma.invitation.findUniqueOrThrow({ where: { id: issued.id } });
      // Backdate expiry.
      await prisma.invitation.update({
        where: { id: issued.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expect(
        invitations.accept(
          { userId: invitee.userId, email: invitee.email, memberships: [] },
          row.token,
        ),
      ).rejects.toMatchObject({
        status: 410,
        response: { code: 'INVITATION_EXPIRED' },
      });
    });

    it('ACCEPTED + different user without membership → 410 INVITATION_ACCEPTED (same-email-different-userId guard)', async () => {
      const { org, actor } = await seedOrgWithOwner();
      const sharedEmail = `shared-${tag()}@example.com`;
      // Seed an already-accepted invitation for sharedEmail.
      const accepted = await prisma.invitation.create({
        data: {
          organizationId: org.id,
          email: sharedEmail,
          role: 'ANALYST',
          token: `tok-${tag()}-acc`,
          expiresAt: new Date(Date.now() + 7 * 86400000),
          acceptedAt: new Date(),
        },
      });
      trackInvitation(accepted.id);
      // A DIFFERENT user owns sharedEmail — never had a membership.
      // (Issue path is bypassed by direct seed; we just need the token.)
      const interloper = await createUser({ email: sharedEmail });
      // Sanity: actor is unused here; pull a token-bearing accept call.
      void actor;

      await expect(
        invitations.accept(
          { userId: interloper.userId, email: interloper.email, memberships: [] },
          accepted.token,
        ),
      ).rejects.toMatchObject({
        status: 410,
        response: { code: 'INVITATION_ACCEPTED' },
      });
    });

    it('unknown token → 404 INVITATION_NOT_FOUND', async () => {
      const user = await createUser();
      await expect(
        invitations.accept(
          { userId: user.userId, email: user.email, memberships: [] },
          'no-such-token-xyz',
        ),
      ).rejects.toMatchObject({
        status: 404,
        response: { code: 'INVITATION_NOT_FOUND' },
      });
    });
  });

  // ------------------------------------------------------------------ //
  // R-Invitation-Revoke                                                //
  // ------------------------------------------------------------------ //

  describe('revoke', () => {
    it('PENDING → sets revokedAt', async () => {
      const { org, actor } = await seedOrgWithOwner();
      const issued = await invitations.issue(actor, org.id, {
        email: `rev-${tag()}@example.com`,
        role: 'VIEWER',
      });
      trackInvitation(issued.id);

      await invitations.revoke(org.id, issued.id);
      const row = await prisma.invitation.findUniqueOrThrow({ where: { id: issued.id } });
      expect(row.revokedAt).not.toBeNull();
    });

    it('REVOKED is idempotent — revokedAt timestamp NOT overwritten', async () => {
      const { org, actor } = await seedOrgWithOwner();
      const issued = await invitations.issue(actor, org.id, {
        email: `revx-${tag()}@example.com`,
        role: 'VIEWER',
      });
      trackInvitation(issued.id);
      await invitations.revoke(org.id, issued.id);
      const firstStamp = (await prisma.invitation.findUniqueOrThrow({ where: { id: issued.id } }))
        .revokedAt;
      await new Promise((r) => setTimeout(r, 5));
      await invitations.revoke(org.id, issued.id); // idempotent
      const secondStamp = (await prisma.invitation.findUniqueOrThrow({ where: { id: issued.id } }))
        .revokedAt;
      expect(secondStamp?.getTime()).toBe(firstStamp?.getTime());
    });

    it('ACCEPTED → 410 ALREADY_ACCEPTED', async () => {
      const { org, actor } = await seedOrgWithOwner();
      const invitee = await createUser();
      const issued = await invitations.issue(actor, org.id, {
        email: invitee.email,
        role: 'VIEWER',
      });
      trackInvitation(issued.id);
      const row = await prisma.invitation.findUniqueOrThrow({ where: { id: issued.id } });
      await invitations.accept(
        { userId: invitee.userId, email: invitee.email, memberships: [] },
        row.token,
      );
      await expect(invitations.revoke(org.id, issued.id)).rejects.toMatchObject({
        status: 410,
        response: { code: 'ALREADY_ACCEPTED' },
      });
    });

    it('cross-org leak protection — revoke on wrong orgId → 404', async () => {
      const { org, actor } = await seedOrgWithOwner();
      const otherOrg = await createOrg();
      const issued = await invitations.issue(actor, org.id, {
        email: `cross-${tag()}@example.com`,
        role: 'VIEWER',
      });
      trackInvitation(issued.id);

      await expect(invitations.revoke(otherOrg.id, issued.id)).rejects.toMatchObject({
        status: 404,
        response: { code: 'INVITATION_NOT_FOUND' },
      });
    });
  });

  // ------------------------------------------------------------------ //
  // R-Invitation-Preview                                               //
  // ------------------------------------------------------------------ //

  describe('preview', () => {
    it('PENDING → returns shape WITHOUT email/id leakage', async () => {
      const { org, owner, actor } = await seedOrgWithOwner();
      const issued = await invitations.issue(actor, org.id, {
        email: `peek-${tag()}@example.com`,
        role: 'ADMIN',
      });
      trackInvitation(issued.id);
      const row = await prisma.invitation.findUniqueOrThrow({ where: { id: issued.id } });

      const preview = await invitations.preview(row.token);
      expect(preview).toEqual({
        orgName: org.name,
        orgSlug: org.slug,
        inviterName: expect.any(String),
        role: 'ADMIN',
        expiresAt: row.expiresAt,
        status: 'PENDING',
      });
      // No leakage.
      expect(preview).not.toHaveProperty('email');
      expect(preview).not.toHaveProperty('id');
      expect(preview).not.toHaveProperty('organizationId');
      void owner;
    });

    it('unknown token → 404', async () => {
      await expect(invitations.preview('xxx-no-such-token')).rejects.toMatchObject({
        status: 404,
        response: { code: 'INVITATION_NOT_FOUND' },
      });
    });

    it('EXPIRED → 410 INVITATION_EXPIRED', async () => {
      const { org, actor } = await seedOrgWithOwner();
      const issued = await invitations.issue(actor, org.id, {
        email: `exp-${tag()}@example.com`,
        role: 'VIEWER',
      });
      trackInvitation(issued.id);
      const row = await prisma.invitation.findUniqueOrThrow({ where: { id: issued.id } });
      await prisma.invitation.update({
        where: { id: issued.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expect(invitations.preview(row.token)).rejects.toMatchObject({
        status: 410,
        response: { code: 'INVITATION_EXPIRED' },
      });
    });
  });

  // ------------------------------------------------------------------ //
  // R-Invitations-List                                                 //
  // ------------------------------------------------------------------ //

  describe('list', () => {
    it('returns ONLY PENDING rows ordered by createdAt DESC, includes invitedByName', async () => {
      const { org, owner, actor } = await seedOrgWithOwner();
      // Issue 3 invitations.
      const a = await invitations.issue(actor, org.id, {
        email: `a-${tag()}@example.com`,
        role: 'VIEWER',
      });
      trackInvitation(a.id);
      // Force createdAt ordering by waiting between inserts.
      await new Promise((r) => setTimeout(r, 5));
      const b = await invitations.issue(actor, org.id, {
        email: `b-${tag()}@example.com`,
        role: 'ANALYST',
      });
      trackInvitation(b.id);
      await new Promise((r) => setTimeout(r, 5));
      const c = await invitations.issue(actor, org.id, {
        email: `c-${tag()}@example.com`,
        role: 'ADMIN',
      });
      trackInvitation(c.id);
      // Revoke `a` so it should NOT appear.
      await invitations.revoke(org.id, a.id);

      const rows = await invitations.list(org.id);
      const ids = rows.map((r) => r.id);
      expect(ids).not.toContain(a.id);
      expect(ids).toContain(b.id);
      expect(ids).toContain(c.id);
      // DESC: c (newest) before b.
      const ci = ids.indexOf(c.id);
      const bi = ids.indexOf(b.id);
      expect(ci).toBeLessThan(bi);
      // invitedByName surfaced.
      const ownerName = (
        await prisma.user.findUniqueOrThrow({
          where: { id: owner.userId },
          select: { name: true },
        })
      ).name;
      expect(rows.find((r) => r.id === b.id)?.invitedByName).toBe(ownerName);
    });
  });
});
