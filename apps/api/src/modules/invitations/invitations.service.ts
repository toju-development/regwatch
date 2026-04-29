import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, type PrismaClient } from '@regwatch/db/client';
import type { AuthUser, Role } from '@regwatch/types';
import { computeInvitationStatus, type InvitationStatus } from '@regwatch/db/invitations';
import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';
import { MembersService } from '../members/members.service.js';
import {
  INVITATION_CREATED_EVENT,
  type InvitationCreatedEvent,
} from '../email/events/invitation-created.event.js';
import {
  INVITATIONS_REPO,
  INVITATION_TTL_DAYS,
  TOKEN_GENERATOR,
  WEB_URL,
  type TokenGenerator,
} from './tokens.js';
import type { InvitationsRepo } from './invitations.repo.js';
import type { IssueInvitationDto } from './dto/issue-invitation.dto.js';

/**
 * RFC 5322-ish minimal email regex. Spec validation happens here (NOT
 * in the DTO) so the service can emit the structured `INVALID_EMAIL`
 * code per spec — `ZodBodyPipe` only emits a generic 400 with `{message,
 * issues}` and no `code` field.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VALID_ROLES = new Set<Role>(['OWNER', 'ADMIN', 'ANALYST', 'VIEWER']);

/**
 * Structured error codes. Mapped 1-to-1 to HTTP status by `NestJS`
 * (the `*Exception` thrown carries the body shape `{code, message}`).
 *
 * Spec mapping (`sdd/org-invitations/spec`):
 *   - `INVALID_EMAIL`                    → 400
 *   - `INVALID_ROLE`                     → 400
 *   - `PERSONAL_ORG_NOT_INVITABLE`       → 400
 *   - `OWNER_INVITE_REQUIRES_OWNER`      → 403
 *   - `EMAIL_MISMATCH`                   → 403
 *   - `ALREADY_MEMBER`                   → 409
 *   - `ALREADY_ACCEPTED`                 → 410
 *   - `INVITATION_NOT_FOUND`             → 404
 *   - `INVITATION_REVOKED`               → 410
 *   - `INVITATION_EXPIRED`               → 410
 *   - `INVITATION_ACCEPTED`              → 410
 */
export const INVITATIONS_ERROR_CODES = {
  INVALID_EMAIL: 'INVALID_EMAIL',
  INVALID_ROLE: 'INVALID_ROLE',
  PERSONAL_ORG_NOT_INVITABLE: 'PERSONAL_ORG_NOT_INVITABLE',
  OWNER_INVITE_REQUIRES_OWNER: 'OWNER_INVITE_REQUIRES_OWNER',
  EMAIL_MISMATCH: 'EMAIL_MISMATCH',
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  ALREADY_ACCEPTED: 'ALREADY_ACCEPTED',
  INVITATION_NOT_FOUND: 'INVITATION_NOT_FOUND',
  INVITATION_REVOKED: 'INVITATION_REVOKED',
  INVITATION_EXPIRED: 'INVITATION_EXPIRED',
  INVITATION_ACCEPTED: 'INVITATION_ACCEPTED',
} as const;

/** Result of {@link InvitationsService.issue}. Status is always PENDING. */
export interface IssueResult {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  invitedById: string;
  status: 'PENDING';
}

/** Row shape returned by {@link InvitationsService.list}. */
export interface InvitationListItem {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  invitedById: string | null;
  invitedByName: string | null;
  createdAt: Date;
}

/** Public preview shape — explicitly DOES NOT leak `id`, `email`, `orgId`. */
export interface InvitationPreview {
  orgName: string;
  orgSlug: string;
  inviterName: string | null;
  role: Role;
  expiresAt: Date;
  status: InvitationStatus;
}

/** Result of {@link InvitationsService.accept}. */
export interface AcceptResult {
  orgId: string;
  role: Role;
}

/**
 * Invitations domain service.
 *
 * Spec: `sdd/org-invitations/spec` (R-Invitation-Issue, R-Invitation-Accept,
 *   R-Invitation-Revoke, R-Invitation-Preview, R-Invitations-List,
 *   R-Email-Port-Hexagonal).
 * Design: `sdd/org-invitations/design` §0 #1-#3, §3, D3 (post-commit emit),
 *   D5 (token generator), D8 (computed status).
 *
 * Foot-gun #667: explicit `@Inject(...)` for every constructor parameter
 * (tsx + NestJS DI does NOT emit decorator metadata for symbol tokens).
 *
 * Cross-cutting invariants:
 *   - Membership INSERT goes EXCLUSIVELY through `MembersService.createOrGet`
 *     (architectural chokepoint — the integration tests assert this).
 *   - The `invitation.created` event is emitted POST-commit (after
 *     `await tx`), never inside the tx body — listener errors MUST NOT
 *     roll back the issue.
 *   - Repo methods that participate in a write accept a `tx` so the
 *     unique-index race (P2002) can be retried on a fresh tx without
 *     leaking aborted state.
 */
@Injectable()
export class InvitationsService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(INVITATIONS_REPO) private readonly repo: InvitationsRepo,
    @Inject(MembersService) private readonly members: MembersService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(TOKEN_GENERATOR) private readonly tokenGen: TokenGenerator,
    @Inject(INVITATION_TTL_DAYS) private readonly ttlDays: number,
    @Inject(WEB_URL) private readonly webUrl: string,
  ) {}

  /**
   * Issue a NEW invitation OR re-issue an existing PENDING one (rotate
   * token, extend expiry, update `invitedById`).
   *
   * Service order (spec R-Invitation-Issue):
   *
   *   1. `INVALID_EMAIL` (400) — email regex.
   *   2. `INVALID_ROLE`  (400) — role enum.
   *   3. `PERSONAL_ORG_NOT_INVITABLE` (400) — actor's `User.personalOrgId`
   *      cannot be invited into.
   *   4. `OWNER_INVITE_REQUIRES_OWNER` (403) — ADMIN cannot mint OWNER.
   *   5. `ALREADY_MEMBER` (409) — any accepted row for `(orgId, email)`.
   *   6. PENDING row exists → REPLACE; else INSERT.
   *      P2002 race → re-enter on a fresh tx (the partial unique index
   *      is the gate — foot-gun #645).
   *   7. Resolve `Organization.{name,slug}` and inviter `User.name`.
   *   8. Emit `invitation.created` POST-commit. Listener swallows errors.
   *
   * Returns `{id, email, role, expiresAt, invitedById, status:'PENDING'}`.
   */
  async issue(actor: AuthUser, orgId: string, input: IssueInvitationDto): Promise<IssueResult> {
    // 1-2. Format / length / enum.
    //
    // Trim defensively BEFORE any check so leading/trailing whitespace
    // never sneaks into the regex (which would pass for `" foo@bar.baz "`
    // due to `[^\s@]+`, but only because the boundary chars happen to be
    // whitespace — not portable). Length cap MUST run before the DB
    // INSERT: `Invitation.email` is `@db.VarChar(254)` and a 255+ char
    // string passes the regex but explodes at the DB layer with a 500.
    const trimmedEmail = input.email.trim();
    if (trimmedEmail.length === 0 || trimmedEmail.length > 254) {
      throw new BadRequestException({
        code: INVITATIONS_ERROR_CODES.INVALID_EMAIL,
        message: 'Email must be 1-254 characters.',
      });
    }
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      throw new BadRequestException({
        code: INVITATIONS_ERROR_CODES.INVALID_EMAIL,
        message: 'Email must be a valid address.',
      });
    }
    if (!VALID_ROLES.has(input.role as Role)) {
      throw new BadRequestException({
        code: INVITATIONS_ERROR_CODES.INVALID_ROLE,
        message: 'Role must be one of OWNER, ADMIN, ANALYST, VIEWER.',
      });
    }
    const role = input.role as Role;
    const email = trimmedEmail.toLowerCase();

    // 3. PersonalOrg guard — invite into the actor's own personalOrg is
    //    nonsense (the actor is the sole member by construction; spec
    //    "personal organizations have no roster").
    const actorUser = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { personalOrgId: true, name: true },
    });
    if (actorUser?.personalOrgId === orgId) {
      throw new BadRequestException({
        code: INVITATIONS_ERROR_CODES.PERSONAL_ORG_NOT_INVITABLE,
        message: 'Personal organizations cannot have invitations.',
      });
    }

    // 4. ADMIN-mints-OWNER guard. Mirror MembersService — actor's role
    //    on `orgId` from the JWT memberships claim (OrgScopeGuard already
    //    verified the actor has SOME membership before this call).
    const actorRole = actor.memberships.find((m) => m.organizationId === orgId)?.role ?? null;
    if (role === 'OWNER' && actorRole !== 'OWNER') {
      throw new ForbiddenException({
        code: INVITATIONS_ERROR_CODES.OWNER_INVITE_REQUIRES_OWNER,
        message: 'Only an OWNER may invite a member as OWNER.',
      });
    }

    // 5. ALREADY_MEMBER — any accepted row for (orgId, email) terminates.
    const accepted = await this.repo.findAcceptedByOrgEmail(orgId, email);
    if (accepted) {
      throw new ConflictException({
        code: INVITATIONS_ERROR_CODES.ALREADY_MEMBER,
        message: 'This email already accepted an invitation to this organization.',
      });
    }

    // 6. Issue (with P2002 retry on race).
    const issued = await this.runIssueTx({
      orgId,
      email,
      role,
      invitedById: actor.userId,
    });

    // 7. Resolve org + inviter for the event payload.
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { name: true, slug: true },
    });

    // 8. POST-commit emit. EventEmitter2 with `{async:true}` listener is
    //    fire-and-forget — listener errors MUST NOT propagate.
    const evt: InvitationCreatedEvent = {
      to: email,
      orgName: org.name,
      inviterName: actorUser?.name ?? null,
      role,
      acceptUrl: `${this.webUrl}/accept/${issued.token}`,
      expiresAt: issued.expiresAt,
    };
    this.events.emit(INVITATION_CREATED_EVENT, evt);

    return {
      id: issued.id,
      email,
      role,
      expiresAt: issued.expiresAt,
      invitedById: actor.userId,
      status: 'PENDING',
    };
  }

  /**
   * One PENDING-or-INSERT cycle wrapped in a tx. On `P2002` (concurrent
   * caller won the unique-index race) the WHOLE tx is rolled back — we
   * re-enter on a fresh connection and the racing pending row is now
   * visible to our SELECT, so the second pass takes the REPLACE path.
   *
   * The retry is bounded to ONE pass: if the second pass also hits
   * `P2002`, the underlying state is genuinely chaotic and we surface
   * the error.
   */
  private async runIssueTx(input: {
    orgId: string;
    email: string;
    role: Role;
    invitedById: string;
  }): Promise<{ id: string; token: string; expiresAt: Date }> {
    try {
      return await this.issueOnce(input);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.issueOnce(input);
      }
      throw err;
    }
  }

  private async issueOnce(input: {
    orgId: string;
    email: string;
    role: Role;
    invitedById: string;
  }): Promise<{ id: string; token: string; expiresAt: Date }> {
    return this.prisma.$transaction(async (tx) => {
      const pending = await this.repo.findPendingByOrgEmail(tx, input.orgId, input.email);
      const token = this.tokenGen.generate();
      const expiresAt = this.computeExpiresAt();
      if (pending) {
        const replaced = await this.repo.replacePending(tx, pending.id, {
          token,
          expiresAt,
          invitedById: input.invitedById,
        });
        return { id: replaced.id, token, expiresAt };
      }
      const created = await this.repo.create(tx, {
        organizationId: input.orgId,
        email: input.email,
        role: input.role,
        token,
        expiresAt,
        invitedById: input.invitedById,
      });
      return { id: created.id, token, expiresAt };
    });
  }

  private computeExpiresAt(): Date {
    return new Date(Date.now() + this.ttlDays * 24 * 60 * 60 * 1000);
  }

  /**
   * List PENDING invitations for `orgId` (newest first). Filtering uses
   * `computeInvitationStatus` so REVOKED / ACCEPTED / EXPIRED rows are
   * dropped consistently with preview + accept.
   */
  async list(orgId: string): Promise<InvitationListItem[]> {
    const rows = await this.repo.listByOrg(orgId);
    const now = new Date();
    return rows
      .filter((r) => computeInvitationStatus(r, now) === 'PENDING')
      .map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role,
        expiresAt: r.expiresAt,
        invitedById: r.invitedById,
        invitedByName: r.invitedByName,
        createdAt: r.createdAt,
      }));
  }

  /**
   * Soft-revoke an invitation.
   *
   * Order:
   *   1. Load by id → 404 if missing OR `organizationId !== orgId`
   *      (cross-org leak protection — never leak existence of an
   *      invitation belonging to a different org).
   *   2. ACCEPTED → 410 `ALREADY_ACCEPTED` (terminal).
   *   3. REVOKED → no-op (idempotent — preserves the original
   *      `revokedAt` timestamp; spec R-Invitation-Revoke).
   *   4. PENDING / EXPIRED → set `revokedAt = now`.
   */
  async revoke(orgId: string, invitationId: string): Promise<void> {
    const inv = await this.repo.findById(invitationId);
    if (!inv || inv.organizationId !== orgId) {
      throw new NotFoundException({
        code: INVITATIONS_ERROR_CODES.INVITATION_NOT_FOUND,
        message: 'Invitation not found.',
      });
    }
    const status = computeInvitationStatus(inv);
    if (status === 'ACCEPTED') {
      throw new GoneException({
        code: INVITATIONS_ERROR_CODES.ALREADY_ACCEPTED,
        message: 'This invitation has already been accepted.',
      });
    }
    if (status === 'REVOKED') return; // idempotent
    await this.repo.markRevokedAt(inv.id, new Date());
  }

  /**
   * Public preview by opaque token.
   *
   * Returns ONLY `{orgName, orgSlug, inviterName, role, expiresAt, status}`
   * — explicitly does NOT leak `id`, `email`, `organizationId`, or the
   * inviter's email/userId (spec R-Invitation-Preview "MUST NOT leak
   * email or org id").
   *
   * Non-PENDING → 410 with the matching `INVITATION_<STATUS>` code.
   * Unknown token → 404 `INVITATION_NOT_FOUND`.
   */
  async preview(token: string): Promise<InvitationPreview> {
    const inv = await this.repo.findByToken(token);
    if (!inv) {
      throw new NotFoundException({
        code: INVITATIONS_ERROR_CODES.INVITATION_NOT_FOUND,
        message: 'Invitation not found.',
      });
    }
    const status = computeInvitationStatus(inv);
    if (status !== 'PENDING') {
      throw new GoneException({
        code: this.statusToCode(status),
        message: `This invitation is ${status.toLowerCase()}.`,
      });
    }
    const [org, inviter] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: inv.organizationId },
        select: { name: true, slug: true },
      }),
      inv.invitedById
        ? this.prisma.user.findUnique({
            where: { id: inv.invitedById },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);
    return {
      orgName: org.name,
      orgSlug: org.slug,
      inviterName: inviter?.name ?? null,
      role: inv.role as Role,
      expiresAt: inv.expiresAt,
      status,
    };
  }

  /**
   * Accept an invitation by token. The CHOKEPOINT for inserting the
   * Membership is `MembersService.createOrGet` — this service NEVER
   * touches `prisma.membership` directly (architectural invariant
   * asserted by the integration spy).
   *
   * Order:
   *   1. Load by token → 404 if unknown.
   *   2. REVOKED / EXPIRED → 410 `INVITATION_<STATUS>`.
   *   3. ACCEPTED + caller has membership → fall through (idempotent
   *      re-accept; the chokepoint will return `created:false`).
   *      ACCEPTED + caller has NO membership → 410 `INVITATION_ACCEPTED`
   *      (covers the same-email-different-userId edge — a different user
   *      cannot ride a previously-accepted token).
   *   4. Email mismatch (strict lowercase) → 403 `EMAIL_MISMATCH`.
   *   5. `MembersService.createOrGet({userId, organizationId, role})` —
   *      INSERT-or-fetch with atomic `User.membershipsVersion++` only on
   *      the INSERT path.
   *   6. If `created === true && acceptedAt === null` → mark accepted.
   *      Idempotent re-accept does NOT touch `acceptedAt` again.
   */
  async accept(actor: AuthUser, token: string): Promise<AcceptResult> {
    const inv = await this.repo.findByToken(token);
    if (!inv) {
      throw new NotFoundException({
        code: INVITATIONS_ERROR_CODES.INVITATION_NOT_FOUND,
        message: 'Invitation not found.',
      });
    }
    const status = computeInvitationStatus(inv);
    if (status === 'REVOKED' || status === 'EXPIRED') {
      throw new GoneException({
        code: this.statusToCode(status),
        message: `This invitation is ${status.toLowerCase()}.`,
      });
    }
    if (status === 'ACCEPTED') {
      const existing = await this.prisma.membership.findUnique({
        where: {
          userId_organizationId: {
            userId: actor.userId,
            organizationId: inv.organizationId,
          },
        },
        select: { id: true },
      });
      if (!existing) {
        throw new GoneException({
          code: INVITATIONS_ERROR_CODES.INVITATION_ACCEPTED,
          message: 'This invitation has already been accepted.',
        });
      }
      // fall through — idempotent re-accept by the original user.
    }
    // 4. Strict lowercase email match.
    if (inv.email !== actor.email.toLowerCase()) {
      throw new ForbiddenException({
        code: INVITATIONS_ERROR_CODES.EMAIL_MISMATCH,
        message: 'This invitation was issued to a different email address.',
      });
    }
    // 5. Chokepoint INSERT-or-fetch.
    const { created } = await this.members.createOrGet({
      userId: actor.userId,
      organizationId: inv.organizationId,
      role: inv.role as Role,
    });
    // 6. Mark accepted on the first successful accept.
    if (created && inv.acceptedAt === null) {
      await this.repo.markAcceptedAt(inv.id, new Date());
    }
    return { orgId: inv.organizationId, role: inv.role as Role };
  }

  private statusToCode(
    s: InvitationStatus,
  ):
    | typeof INVITATIONS_ERROR_CODES.INVITATION_REVOKED
    | typeof INVITATIONS_ERROR_CODES.INVITATION_EXPIRED
    | typeof INVITATIONS_ERROR_CODES.INVITATION_ACCEPTED {
    switch (s) {
      case 'REVOKED':
        return INVITATIONS_ERROR_CODES.INVITATION_REVOKED;
      case 'EXPIRED':
        return INVITATIONS_ERROR_CODES.INVITATION_EXPIRED;
      case 'ACCEPTED':
        return INVITATIONS_ERROR_CODES.INVITATION_ACCEPTED;
      // PENDING is never mapped to an error code — caller handles it
      // before reaching this helper. Defensive default keeps the type
      // narrow for the controller layer.
      default:
        return INVITATIONS_ERROR_CODES.INVITATION_REVOKED;
    }
  }
}
