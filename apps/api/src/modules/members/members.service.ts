import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, type PrismaClient } from '@regwatch/db/client';
import type { AuthUser, Role } from '@regwatch/types';
import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';
import { MEMBERS_REPO_TOKEN, type MembersRepo, type MemberRow } from './members.repo.js';

/**
 * Numeric rank for {@link Role} used by the self-promote / cross-user
 * promote invariants. Higher = more privileged.
 *
 * Source of truth for the comparison rules in
 * `sdd/org-members/spec` R-Membership-Update:
 *   - "self-promote MUST be rejected" → newRank > actorCurrentRank.
 *   - "ADMIN MUST NOT promote anyone to OWNER" → only OWNER may write
 *     a row whose role becomes `OWNER`.
 */
const ROLE_RANK: Record<Role, number> = {
  VIEWER: 1,
  ANALYST: 2,
  ADMIN: 3,
  OWNER: 4,
};

/**
 * Structured error codes surfaced as the `code` field of the JSON body
 * for the corresponding HTTP error. The controller layer (B4) maps
 * these 1-to-1 to HTTP status; the codes are stable contract so the
 * web layer can match without parsing prose.
 *
 * Spec mapping:
 *   - `SELF_PROMOTE_FORBIDDEN`        → 403 (R-Membership-Update)
 *   - `OWNER_PROMOTE_REQUIRES_OWNER`  → 403 (R-Membership-Update)
 *   - `OWNER_REMOVE_REQUIRES_OWNER`   → 403 (R-Membership-Remove)
 *   - `LAST_OWNER`                    → 409 (PATCH + DELETE)
 *   - `PERSONAL_ORG_UNREMOVABLE`      → 400 (R-Membership-Remove)
 *   - `MEMBERSHIP_NOT_FOUND`          → 404 (defense-in-depth)
 */
export const MEMBERS_ERROR_CODES = {
  SELF_PROMOTE_FORBIDDEN: 'SELF_PROMOTE_FORBIDDEN',
  OWNER_PROMOTE_REQUIRES_OWNER: 'OWNER_PROMOTE_REQUIRES_OWNER',
  OWNER_REMOVE_REQUIRES_OWNER: 'OWNER_REMOVE_REQUIRES_OWNER',
  LAST_OWNER: 'LAST_OWNER',
  PERSONAL_ORG_UNREMOVABLE: 'PERSONAL_ORG_UNREMOVABLE',
  MEMBERSHIP_NOT_FOUND: 'MEMBERSHIP_NOT_FOUND',
} as const;

/**
 * Members domain service.
 *
 * **B2** exposed only `getCurrentVersion` — the live `User.membershipsVersion`
 * read consumed by `MembershipFreshnessGuard` (with a `(userId, jwtIat)`
 * cache).
 *
 * **B3 (this batch)** lands the transactional chokepoint:
 *
 *   - {@link list}       — `GET /org/:orgId/members` payload (B4 controller).
 *   - {@link updateRole} — PATCH role with the full invariant chain
 *     (self-promote, ADMIN-vs-OWNER, last-OWNER) + atomic
 *     `User.membershipsVersion` bump.
 *   - {@link remove}     — DELETE membership with personalOrg /
 *     ADMIN-vs-OWNER / last-OWNER guards + atomic bump.
 *   - {@link mutate}     — private chokepoint that wraps every Membership
 *     write in a single `prisma.$transaction` and bumps the affected
 *     user's `membershipsVersion` as the last step of the tx (foot-gun
 *     #645: same `tx`, never the bare `prisma`).
 *
 * Foot-gun #667: explicit `@Inject(...)` for every constructor param
 * under tsx + NestJS DI.
 *
 * Spec: `sdd/org-members/spec` R-Membership-Update, R-Membership-Remove,
 *   R-Members-List, R-User-Memberships-Version, R-Jwt-Invalidate-Cross-User.
 * Design: `sdd/org-members/design` §0 #4, #6, §2 (service order), §3, §5.
 */
@Injectable()
export class MembersService {
  constructor(
    @Inject(MEMBERS_REPO_TOKEN) private readonly repo: MembersRepo,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  /**
   * Returns the live `User.membershipsVersion` for `userId`.
   *
   * The freshness guard wraps this call in a `(userId, jwtIat)`-keyed
   * 30s cache; this method itself does NOT cache — it issues one
   * SELECT per call. The cache lives at the guard layer per design §3.
   */
  async getCurrentVersion(userId: string): Promise<number> {
    return this.repo.getUserMembershipsVersion(userId);
  }

  /**
   * List members of `orgId` ordered by `joinedAt ASC`.
   *
   * The caller (controller B4) is responsible for the auth chain
   * (`JwtAuthGuard` → `MembershipFreshnessGuard` → `OrgScopeGuard` →
   * `RolesGuard('OWNER','ADMIN','ANALYST','VIEWER')`); this method does
   * not duplicate those checks.
   */
  async list(orgId: string): Promise<MemberRow[]> {
    return this.repo.listByOrg(orgId);
  }

  /**
   * PATCH `Membership(orgId, targetUserId).role`.
   *
   * Service order (per design §2 — all reads + writes share one `tx`):
   *
   *   1. Load target Membership in `orgId`. → 404 `MEMBERSHIP_NOT_FOUND`.
   *   2. Self-promote check (when `actor === target` AND new role rank
   *      > actor's current rank on `orgId`). → 403
   *      `SELF_PROMOTE_FORBIDDEN`.
   *   3. ADMIN-promotes-to-OWNER (cross-user write where actor's role
   *      on `orgId` is not OWNER and the new role is OWNER). → 403
   *      `OWNER_PROMOTE_REQUIRES_OWNER`.
   *   4. Last-OWNER guard: when target is currently OWNER and the new
   *      role is not OWNER, count owners; if exactly 1, → 409 `LAST_OWNER`.
   *   5. Update role.
   *   6. Bump `User.membershipsVersion` for `targetUserId` (same tx).
   *
   * The `actor.memberships[]` claim is the source of truth for the
   * actor's role on `orgId` — `OrgScopeGuard` already verified the
   * actor has SOME membership on `orgId` before this call.
   */
  async updateRole(
    actor: AuthUser,
    orgId: string,
    targetUserId: string,
    newRole: Role,
  ): Promise<void> {
    const actorRole = this.actorRoleOnOrg(actor, orgId);
    const isSelf = actor.userId === targetUserId;

    return this.mutate({
      affectedUserId: targetUserId,
      action: async (tx) => {
        const target = await this.repo.findInOrg(tx, orgId, targetUserId);
        if (!target) {
          throw new NotFoundException({
            code: MEMBERS_ERROR_CODES.MEMBERSHIP_NOT_FOUND,
            message: 'Target membership not found in this organization.',
          });
        }

        // 2. Self-promote — actor cannot raise their own privilege.
        if (isSelf && ROLE_RANK[newRole] > ROLE_RANK[target.role]) {
          throw new ForbiddenException({
            code: MEMBERS_ERROR_CODES.SELF_PROMOTE_FORBIDDEN,
            message: 'You cannot promote yourself.',
          });
        }

        // 3. Cross-user ADMIN→OWNER — only an OWNER may mint another OWNER.
        if (!isSelf && newRole === 'OWNER' && actorRole !== 'OWNER') {
          throw new ForbiddenException({
            code: MEMBERS_ERROR_CODES.OWNER_PROMOTE_REQUIRES_OWNER,
            message: 'Only an OWNER may promote a member to OWNER.',
          });
        }

        // 4. Last-OWNER demote.
        if (target.role === 'OWNER' && newRole !== 'OWNER') {
          const owners = await this.repo.countOwners(tx, orgId);
          if (owners <= 1) {
            throw new ConflictException({
              code: MEMBERS_ERROR_CODES.LAST_OWNER,
              message: 'Cannot demote the last OWNER of this organization.',
            });
          }
        }

        // 5. Write.
        await this.repo.updateMembershipRole(tx, target.id, newRole);
      },
    });
  }

  /**
   * DELETE `Membership(orgId, targetUserId)`.
   *
   * Service order (per design §2):
   *
   *   1. Load target Membership. → 404 `MEMBERSHIP_NOT_FOUND`.
   *   2. PersonalOrg guard: if `target.user.personalOrgId === orgId`,
   *      → 400 `PERSONAL_ORG_UNREMOVABLE` (covers admin-remove AND
   *      self-leave on personal org — spec R-Membership-Remove).
   *   3. ADMIN-removes-OWNER cross-user → 403
   *      `OWNER_REMOVE_REQUIRES_OWNER`. Self-leave is unaffected
   *      (target === actor; the OWNER protection here is about
   *      cross-user demotion-via-deletion).
   *   4. Last-OWNER guard: if the target is currently OWNER and is the
   *      sole OWNER, → 409 `LAST_OWNER` (covers cross-user remove AND
   *      self-leave when actor is the lone OWNER).
   *   5. Delete membership.
   *   6. Bump `User.membershipsVersion` for `targetUserId` (same tx).
   */
  async remove(actor: AuthUser, orgId: string, targetUserId: string): Promise<void> {
    const actorRole = this.actorRoleOnOrg(actor, orgId);
    const isSelf = actor.userId === targetUserId;

    return this.mutate({
      affectedUserId: targetUserId,
      action: async (tx) => {
        const target = await this.repo.findInOrg(tx, orgId, targetUserId);
        if (!target) {
          throw new NotFoundException({
            code: MEMBERS_ERROR_CODES.MEMBERSHIP_NOT_FOUND,
            message: 'Target membership not found in this organization.',
          });
        }

        // 2. PersonalOrg guard — covers self-leave on personal org too.
        const personalOrgId = await this.repo.findUserPersonalOrgId(tx, targetUserId);
        if (personalOrgId !== null && personalOrgId === orgId) {
          throw new BadRequestException({
            code: MEMBERS_ERROR_CODES.PERSONAL_ORG_UNREMOVABLE,
            message: 'Cannot remove a user from their personal organization.',
          });
        }

        // 3. Cross-user ADMIN-removes-OWNER.
        if (!isSelf && target.role === 'OWNER' && actorRole !== 'OWNER') {
          throw new ForbiddenException({
            code: MEMBERS_ERROR_CODES.OWNER_REMOVE_REQUIRES_OWNER,
            message: 'Only an OWNER may remove an OWNER.',
          });
        }

        // 4. Last-OWNER guard.
        if (target.role === 'OWNER') {
          const owners = await this.repo.countOwners(tx, orgId);
          if (owners <= 1) {
            throw new ConflictException({
              code: MEMBERS_ERROR_CODES.LAST_OWNER,
              message: 'Cannot remove the last OWNER of this organization.',
            });
          }
        }

        // 5. Delete.
        await this.repo.deleteMembership(tx, target.id);
      },
    });
  }

  /**
   * Resolve the actor's role on `orgId` from the JWT `memberships[]`
   * claim. Returns `null` when the actor has no membership claim for
   * `orgId` — `OrgScopeGuard` should have rejected the request before
   * we get here, but the service treats a missing claim as "not OWNER"
   * for defense-in-depth (the cross-user OWNER write would still be
   * blocked by the `OWNER_PROMOTE_REQUIRES_OWNER` rule).
   */
  private actorRoleOnOrg(actor: AuthUser, orgId: string): Role | null {
    const claim = actor.memberships.find((m) => m.organizationId === orgId);
    return claim ? claim.role : null;
  }

  /**
   * Single-tx chokepoint for every Membership write.
   *
   * Wraps `action` in `prisma.$transaction(async tx => …)` and bumps
   * `User.membershipsVersion` for `affectedUserId` as the LAST statement
   * inside the same tx. If `action` (or the bump itself) throws, Prisma
   * rolls the entire tx back — `User.membershipsVersion` is unchanged
   * (R-User-Memberships-Version "Rollback rolls back the version bump").
   *
   * This is the ONLY path that should reach `tx.membership.update/delete/
   * create` from the members module — keeping the surface narrow makes
   * the atomicity invariant statically auditable (foot-gun #645).
   *
   * Exposed as `protected` (not `private`) so a forthcoming invitation
   * accept flow (MVP-3b3b) can call into the same chokepoint when a
   * Membership is INSERTED — the `mv` bump rule applies identically
   * (R-User-Memberships-Version "Membership INSERT bumps version").
   */
  protected async mutate<T>(args: {
    affectedUserId: string;
    action: (tx: Prisma.TransactionClient) => Promise<T>;
  }): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const result = await args.action(tx);
      await this.repo.bumpUserVersion(tx, args.affectedUserId);
      return result;
    });
  }
}
