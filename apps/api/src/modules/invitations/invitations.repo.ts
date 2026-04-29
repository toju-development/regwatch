import { Inject, Injectable } from '@nestjs/common';
import { type Invitation, type Prisma, type PrismaClient } from '@regwatch/db/client';
import type { Role } from '@regwatch/types';
import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';

/**
 * Row shape returned by {@link InvitationsRepo.listByOrg}. Includes the
 * inviter's display name so the list endpoint (B5) can render
 * "Invited by …" without a second join in the controller.
 */
export interface InvitationListRow {
  id: string;
  email: string;
  role: Role;
  token: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  invitedById: string | null;
  invitedByName: string | null;
}

/**
 * Persistence boundary for the invitations module.
 *
 * Spec: `sdd/org-invitations/spec` R-Invitation-Issue, R-Invitation-Accept,
 *   R-Invitation-Revoke, R-Invitation-Preview, R-Invitations-List.
 * Design: `sdd/org-invitations/design` §3 (DI + repo split), D8 (computed
 *   status — repo returns raw rows, service applies `computeInvitationStatus`).
 *
 * Foot-gun #667: every cross-module / cross-interface inject MUST go
 * through a `Symbol`-keyed token paired with explicit `@Inject(...)`. The
 * `INVITATIONS_REPO` symbol lives in `tokens.ts`.
 *
 * Foot-gun #687: every read in the service+test layer is scoped to the
 * specific `(orgId, email)` or `(token)` tuple — there is no surface here
 * that returns a global `count(*)` or unbounded list.
 */
export interface InvitationsRepo {
  /** Load by primary key. Returns `null` when missing. */
  findById(id: string): Promise<Invitation | null>;

  /** Load by opaque token (unique). Returns `null` when missing. */
  findByToken(token: string): Promise<Invitation | null>;

  /**
   * Find the (at most one) pending row for `(orgId, email)`. The partial
   * unique index `invitation_pending_org_email_uq` guarantees uniqueness
   * — multiple pending rows are impossible by construction. Run inside
   * the issue tx so the matching REPLACE writes against the row we read.
   */
  findPendingByOrgEmail(
    tx: Prisma.TransactionClient,
    orgId: string,
    email: string,
  ): Promise<Invitation | null>;

  /**
   * Returns `true` when there exists ANY accepted invitation row for
   * `(orgId, email)` (regardless of token rotation). Drives the
   * `ALREADY_MEMBER` 409 on issue: a successful accept is terminal.
   */
  findAcceptedByOrgEmail(orgId: string, email: string): Promise<boolean>;

  /**
   * List invitations for `orgId` with the inviter's display name joined.
   * Order: `createdAt DESC` (most recent first — matches the UI's "newest
   * invitations on top" affordance for B7).
   *
   * Service applies `computeInvitationStatus` to filter PENDING — the
   * repo deliberately returns ALL rows so the service can reuse the
   * single source of truth for status (D8) without re-encoding the
   * REVOKED > ACCEPTED > EXPIRED > PENDING precedence at the SQL layer.
   */
  listByOrg(orgId: string): Promise<InvitationListRow[]>;

  /**
   * INSERT a new invitation. Caller has already verified there is no
   * pending row for `(orgId, email)` AND no accepted row. The unique
   * index on `token` + the partial unique on `(orgId, email)` are the
   * race gates — `P2002` from this call is the service's signal to
   * re-enter the issue path on a fresh tx (foot-gun #645: rely on the
   * unique index, never on a prior SELECT).
   */
  create(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string;
      email: string;
      role: Role;
      token: string;
      expiresAt: Date;
      invitedById: string;
    },
  ): Promise<Invitation>;

  /**
   * REPLACE the pending row identified by `id`: rotate `token`, extend
   * `expiresAt`, update `invitedById`. Role is intentionally NOT updated
   * — spec R-Invitation-Issue scenario "Re-issue refreshes token and
   * expiresAt" ties role to the original pending row.
   */
  replacePending(
    tx: Prisma.TransactionClient,
    id: string,
    patch: { token: string; expiresAt: Date; invitedById: string },
  ): Promise<Invitation>;

  /**
   * Soft-revoke: set `revokedAt = now`. Caller (service) is responsible
   * for the idempotency check — a row that is ALREADY REVOKED MUST NOT
   * be overwritten (preserves audit timestamp; spec R-Invitation-Revoke
   * "REVOKED is idempotent and does not move the timestamp").
   */
  markRevokedAt(id: string, now: Date): Promise<void>;

  /** Mark accepted: set `acceptedAt = now`. Used post-membership-create. */
  markAcceptedAt(id: string, now: Date): Promise<void>;
}

@Injectable()
export class PrismaInvitationsRepo implements InvitationsRepo {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Invitation | null> {
    return this.prisma.invitation.findUnique({ where: { id } });
  }

  async findByToken(token: string): Promise<Invitation | null> {
    return this.prisma.invitation.findUnique({ where: { token } });
  }

  async findPendingByOrgEmail(
    tx: Prisma.TransactionClient,
    orgId: string,
    email: string,
  ): Promise<Invitation | null> {
    return tx.invitation.findFirst({
      where: {
        organizationId: orgId,
        email,
        acceptedAt: null,
        revokedAt: null,
      },
    });
  }

  async findAcceptedByOrgEmail(orgId: string, email: string): Promise<boolean> {
    const row = await this.prisma.invitation.findFirst({
      where: { organizationId: orgId, email, acceptedAt: { not: null } },
      select: { id: true },
    });
    return row !== null;
  }

  async listByOrg(orgId: string): Promise<InvitationListRow[]> {
    const rows = await this.prisma.invitation.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        token: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        createdAt: true,
        invitedById: true,
        invitedBy: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role as Role,
      token: r.token,
      expiresAt: r.expiresAt,
      acceptedAt: r.acceptedAt,
      revokedAt: r.revokedAt,
      createdAt: r.createdAt,
      invitedById: r.invitedById,
      invitedByName: r.invitedBy?.name ?? null,
    }));
  }

  async create(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string;
      email: string;
      role: Role;
      token: string;
      expiresAt: Date;
      invitedById: string;
    },
  ): Promise<Invitation> {
    return tx.invitation.create({
      data: {
        organizationId: input.organizationId,
        email: input.email,
        role: input.role,
        token: input.token,
        expiresAt: input.expiresAt,
        invitedById: input.invitedById,
      },
    });
  }

  async replacePending(
    tx: Prisma.TransactionClient,
    id: string,
    patch: { token: string; expiresAt: Date; invitedById: string },
  ): Promise<Invitation> {
    return tx.invitation.update({
      where: { id },
      data: {
        token: patch.token,
        expiresAt: patch.expiresAt,
        invitedById: patch.invitedById,
      },
    });
  }

  async markRevokedAt(id: string, now: Date): Promise<void> {
    await this.prisma.invitation.update({
      where: { id },
      data: { revokedAt: now },
      select: { id: true },
    });
  }

  async markAcceptedAt(id: string, now: Date): Promise<void> {
    await this.prisma.invitation.update({
      where: { id },
      data: { acceptedAt: now },
      select: { id: true },
    });
  }
}
