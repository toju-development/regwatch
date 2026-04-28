import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUser, Role } from '@regwatch/types';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { CurrentOrg } from '../../common/auth/decorators/current-org.decorator.js';
import { RolesOrSelf } from '../../common/auth/decorators/roles-or-self.decorator.js';
import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe.js';
import { updateMemberRoleSchema, type UpdateMemberRoleDto } from './dto/update-member-role.dto.js';
import { MembersService } from './members.service.js';

/**
 * Wire shape for `GET /org/:orgId/members`.
 *
 * Mirrors `MemberRow` from `members.repo.ts` with `joinedAt` serialized
 * as an ISO string. Spec: `sdd/org-members/spec` R-Members-List.
 */
export interface MemberListEntryDto {
  userId: string;
  email: string;
  name: string | null;
  role: Role;
  joinedAt: string;
  isPersonalOrgOwner: boolean;
}

export interface MembersListResponseDto {
  members: MemberListEntryDto[];
}

/**
 * `/org/:orgId/members` HTTP surface for `sdd/org-members` (MVP-3b3a).
 *
 * Mounted at the NestJS-native path `/org/:orgId/members[/:userId]`. The
 * browser hits these endpoints via PROXY MODE (#666) at
 * `/api/org/:orgId/members[/:userId]` — the proxy handlers land in B5.
 *
 * Guard chain (per design §2):
 *   1. {@link JwtAuthGuard}              — verifies the Bearer JWT.
 *   2. {@link MembershipFreshnessGuard}  — 401 `STALE_MEMBERSHIPS` on
 *      stale `mv` claim.
 *   3. {@link OrgScopeGuard}             — resolves `X-Org-Id` against
 *      `memberships[]` and attaches `request.membership`.
 *   4. {@link RolesGuard}                — short-circuits to `true` on
 *      handlers that declare no `@Roles(...)` (PATCH/DELETE here use
 *      `@RolesOrSelf(...)` instead, which intentionally bypasses
 *      `RolesGuard` per design §0 #2).
 *   5. {@link RolesOrSelfGuard}          — handler-level via
 *      `@RolesOrSelf(...)`; allows the declared roles OR self-target.
 *
 * Defense-in-depth: every handler asserts `:orgId === currentOrg.organizationId`.
 * `OrgScopeGuard` is the actual gate (it resolves the active org from
 * `X-Org-Id`); the assertion catches the pathological case where the
 * client sends a different `:orgId` segment than the `X-Org-Id` header.
 *
 * Constructor uses explicit `@Inject(MembersService)` per foot-gun #667
 * (tsx + NestJS DI requires explicit tokens; the `tsx` esbuild
 * transformer does not emit `design:paramtypes` metadata).
 *
 * Spec: `sdd/org-members/spec`
 *   - R-Members-List
 *   - R-Membership-Update
 *   - R-Membership-Remove
 * Design: `sdd/org-members/design` §0 #1-#2, §2, §5.
 */
@Controller('org/:orgId/members')
export class MembersController {
  constructor(@Inject(MembersService) private readonly service: MembersService) {}

  /**
   * `GET /org/:orgId/members` — list every member of the org.
   *
   * All members of `:orgId` may list (Q7-A): no `@Roles(...)` is needed
   * because `OrgScopeGuard` already verified the caller has SOME
   * membership in `:orgId`. `Cache-Control: no-store` per design §2 —
   * the list mutates on every membership write.
   */
  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Param('orgId') orgId: string,
    @CurrentOrg() currentOrgId: string,
  ): Promise<MembersListResponseDto> {
    this.assertOrgScope(orgId, currentOrgId);
    const rows = await this.service.list(orgId);
    return {
      members: rows.map((r) => ({
        userId: r.userId,
        email: r.email,
        name: r.name,
        role: r.role,
        joinedAt: r.joinedAt.toISOString(),
        isPersonalOrgOwner: r.isPersonalOrgOwner,
      })),
    };
  }

  /**
   * `PATCH /org/:orgId/members/:userId` — change a member's role.
   *
   * `@RolesOrSelf('OWNER','ADMIN')` allows OWNER/ADMIN actors OR the
   * caller targeting themselves (self-target — spec Q8 self-downgrade).
   * The service layer enforces the structural invariants (self-promote,
   * ADMIN→OWNER, last-OWNER) and the atomic `User.membershipsVersion`
   * bump inside `prisma.$transaction`.
   *
   * Returns 204 No Content on success — the web layer revalidates the
   * RSC tree via `revalidatePath`, no body shape contract needed.
   */
  @Patch(':userId')
  @RolesOrSelf('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: AuthUser | undefined,
    @CurrentOrg() currentOrgId: string,
    @Body(new ZodBodyPipe(updateMemberRoleSchema)) body: UpdateMemberRoleDto,
  ): Promise<void> {
    if (!user) throw new UnauthorizedException('JWT required.');
    this.assertOrgScope(orgId, currentOrgId);
    await this.service.updateRole(user, orgId, targetUserId, body.role);
  }

  /**
   * `DELETE /org/:orgId/members/:userId` — remove a membership.
   *
   * `@RolesOrSelf('OWNER','ADMIN')` covers both flows:
   *   - Cross-user remove by an OWNER/ADMIN.
   *   - Self-leave (spec Q8) — caller `=== :userId`.
   *
   * Service enforces `PERSONAL_ORG_UNREMOVABLE` (400),
   * `OWNER_REMOVE_REQUIRES_OWNER` (403) and `LAST_OWNER` (409). Returns
   * 204 No Content on success.
   */
  @Delete(':userId')
  @RolesOrSelf('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: AuthUser | undefined,
    @CurrentOrg() currentOrgId: string,
  ): Promise<void> {
    if (!user) throw new UnauthorizedException('JWT required.');
    this.assertOrgScope(orgId, currentOrgId);
    await this.service.remove(user, orgId, targetUserId);
  }

  /**
   * Defense-in-depth: the `:orgId` URL segment MUST equal the org
   * resolved by `OrgScopeGuard` (which gates on the `X-Org-Id` header).
   * The guard is the actual security boundary; this assertion catches
   * the pathological client that sends a `:orgId` different from its
   * `X-Org-Id` header — surfaces as 403 rather than letting the call
   * silently target the header-resolved org.
   *
   * Why 403 (not 400): the client IS authenticated and IS a member of
   * `currentOrgId`; they're simply not authorized to act on `:orgId`
   * (which is a different org from their resolved scope).
   */
  private assertOrgScope(orgIdParam: string, currentOrgId: string): void {
    if (currentOrgId !== orgIdParam) {
      throw new ForbiddenException('Path :orgId does not match resolved org scope');
    }
  }
}
