import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@regwatch/db/client';
import type { Role } from '@regwatch/types';
import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';
import { MEMBERS_REPO_TOKEN } from './tokens.js';

/**
 * Persistence boundary for the members module.
 *
 * **B2** added `getUserMembershipsVersion` for `MembershipFreshnessGuard`.
 * **B3 (this batch)** extends the contract with the reads + writes the
 * transactional `MembersService.mutate(...)` chokepoint needs:
 *
 *   - {@link findInOrg}            — load a target Membership scoped to an org.
 *   - {@link findUserPersonalOrgId} — for the personal-org-unremovable guard.
 *   - {@link countOwners}          — last-OWNER guard preflight (in-tx).
 *   - {@link updateMembershipRole} — the write half of PATCH (in-tx).
 *   - {@link deleteMembership}     — the write half of DELETE (in-tx).
 *   - {@link bumpUserVersion}      — atomic `User.membershipsVersion++` (in-tx).
 *   - {@link listByOrg}            — list payload for `GET /org/:orgId/members`.
 *
 * Every method that participates in a Membership write accepts a
 * `Prisma.TransactionClient` ("`tx`") so the caller controls the
 * transaction boundary. The chokepoint passes the tx Prisma hands it
 * inside `prisma.$transaction(async tx => …)` — foot-gun #645: the
 * last-OWNER count, the row write, AND the `User.membershipsVersion`
 * bump MUST run on the same `tx`, never the bare `prisma` singleton.
 *
 * Spec: `sdd/org-members/spec` R-Membership-Update, R-Membership-Remove,
 *   R-User-Memberships-Version (atomicity), R-Members-List.
 * Design: `sdd/org-members/design` §0 #6, §2 (service order), §5 (DI).
 */
export interface MembersRepo {
  /**
   * Returns the live `User.membershipsVersion` for `userId` — 0 when the
   * row is missing (defensive; the column is NOT NULL with a default of
   * 0 since migration `add_user_memberships_version`).
   */
  getUserMembershipsVersion(userId: string): Promise<number>;

  /**
   * Load the `Membership` for `(orgId, userId)` — `null` when the user
   * has no membership in that org. Returns the minimal shape the
   * service layer needs for invariant checks.
   *
   * @param tx - The transaction client received from
   *   `prisma.$transaction(async tx => …)`. The read MUST live inside
   *   the same tx as the subsequent write so the row's role at decision
   *   time is the role at write time (READ COMMITTED is sufficient — we
   *   hold no write lock that races; foot-gun #645 §B3.2).
   */
  findInOrg(
    tx: Prisma.TransactionClient,
    orgId: string,
    userId: string,
  ): Promise<{ id: string; userId: string; organizationId: string; role: Role } | null>;

  /**
   * Returns the `User.personalOrgId` for `userId` (nullable). Used by the
   * remove-membership invariant (`PERSONAL_ORG_UNREMOVABLE`).
   */
  findUserPersonalOrgId(tx: Prisma.TransactionClient, userId: string): Promise<string | null>;

  /**
   * Counts the number of `OWNER` memberships in `orgId`. Read inside the
   * same `$transaction` as the subsequent write so the last-OWNER guard
   * is consistent with the row mutation (foot-gun #645).
   */
  countOwners(tx: Prisma.TransactionClient, orgId: string): Promise<number>;

  /**
   * Update a Membership's role. Must run inside the chokepoint's tx so
   * the matching `bumpUserVersion(tx, …)` rolls back atomically on
   * failure (R-User-Memberships-Version "Rollback rolls back the
   * version bump").
   */
  updateMembershipRole(
    tx: Prisma.TransactionClient,
    membershipId: string,
    role: Role,
  ): Promise<void>;

  /** Delete a Membership row by id (in-tx; same atomicity rationale). */
  deleteMembership(tx: Prisma.TransactionClient, membershipId: string): Promise<void>;

  /**
   * Increment `User.membershipsVersion` by 1 for `userId`. The chokepoint
   * calls this for EACH affected user as the last step of the tx so the
   * matching JWT's `mv` claim becomes stale (R-Jwt-Invalidate-Cross-User).
   */
  bumpUserVersion(tx: Prisma.TransactionClient, userId: string): Promise<void>;

  /**
   * List members of `orgId` ordered by `Membership.createdAt ASC`
   * (rendered as `joinedAt` on the wire). `isPersonalOrgOwner` is `true`
   * iff the member's `User.personalOrgId === orgId` — needed by the UI
   * to disable the "remove" affordance on personal-org owners
   * (`PERSONAL_ORG_UNREMOVABLE`).
   */
  listByOrg(orgId: string): Promise<MemberRow[]>;
}

/** Row shape returned by {@link MembersRepo.listByOrg}. */
export interface MemberRow {
  userId: string;
  email: string;
  name: string | null;
  role: Role;
  joinedAt: Date;
  isPersonalOrgOwner: boolean;
}

/**
 * Prisma-backed implementation of {@link MembersRepo}.
 *
 * Holds no state of its own — the `PrismaClient` singleton is resolved
 * via DI (`PRISMA_CLIENT` token, provided by the global `PrismaModule`).
 * The transactional methods accept the `tx` client the chokepoint
 * receives from `prisma.$transaction`; non-transactional reads
 * (`getUserMembershipsVersion`, `listByOrg`) use the singleton.
 *
 * Foot-gun #628/#667: explicit `@Inject(PRISMA_CLIENT)` is mandatory
 * under tsx + NestJS DI.
 */
@Injectable()
export class PrismaMembersRepo implements MembersRepo {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async getUserMembershipsVersion(userId: string): Promise<number> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { membershipsVersion: true },
    });
    return row?.membershipsVersion ?? 0;
  }

  async findInOrg(
    tx: Prisma.TransactionClient,
    orgId: string,
    userId: string,
  ): Promise<{ id: string; userId: string; organizationId: string; role: Role } | null> {
    const row = await tx.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      select: { id: true, userId: true, organizationId: true, role: true },
    });
    return row ? { ...row, role: row.role as Role } : null;
  }

  async findUserPersonalOrgId(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<string | null> {
    const row = await tx.user.findUnique({
      where: { id: userId },
      select: { personalOrgId: true },
    });
    return row?.personalOrgId ?? null;
  }

  async countOwners(tx: Prisma.TransactionClient, orgId: string): Promise<number> {
    return tx.membership.count({
      where: { organizationId: orgId, role: 'OWNER' },
    });
  }

  async updateMembershipRole(
    tx: Prisma.TransactionClient,
    membershipId: string,
    role: Role,
  ): Promise<void> {
    await tx.membership.update({
      where: { id: membershipId },
      data: { role },
      select: { id: true },
    });
  }

  async deleteMembership(tx: Prisma.TransactionClient, membershipId: string): Promise<void> {
    await tx.membership.delete({
      where: { id: membershipId },
      select: { id: true },
    });
  }

  async bumpUserVersion(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await tx.user.update({
      where: { id: userId },
      data: { membershipsVersion: { increment: 1 } },
      select: { id: true },
    });
  }

  async listByOrg(orgId: string): Promise<MemberRow[]> {
    const rows = await this.prisma.membership.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'asc' },
      select: {
        userId: true,
        role: true,
        createdAt: true,
        user: {
          select: { email: true, name: true, personalOrgId: true },
        },
      },
    });
    return rows.map((r) => ({
      userId: r.userId,
      email: r.user.email,
      name: r.user.name,
      role: r.role as Role,
      joinedAt: r.createdAt,
      isPersonalOrgOwner: r.user.personalOrgId === orgId,
    }));
  }
}

// Re-export for convenience so importers don't have to round-trip via
// `tokens.js` for the sole token they care about at this layer.
export { MEMBERS_REPO_TOKEN };
