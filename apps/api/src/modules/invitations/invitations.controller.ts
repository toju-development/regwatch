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
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUser, Role } from '@regwatch/types';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { CurrentOrg } from '../../common/auth/decorators/current-org.decorator.js';
import { PublicScope } from '../../common/auth/decorators/public-scope.decorator.js';
import { Roles } from '../../common/auth/decorators/roles.decorator.js';
import { Public } from '../../common/auth/public.decorator.js';
import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe.js';
import { issueInvitationSchema, type IssueInvitationDto } from './dto/issue-invitation.dto.js';
import { InvitationsService } from './invitations.service.js';

/**
 * Wire shape for `POST /org/:orgId/invitations` 201 response.
 *
 * Spec: `sdd/org-invitations/spec` R-Invitation-Issue. Note the absence
 * of `token` — the opaque token is delivered ONLY through the
 * `invitation.created` event → `EmailListener` (the `acceptUrl`). The
 * HTTP issuer NEVER sees the raw token (defence-in-depth: leaks via
 * server logs / proxy access logs are scoped to email-side delivery).
 */
export interface IssueInvitationResponseDto {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  invitedById: string;
  status: 'PENDING';
}

/**
 * Wire shape for one row of `GET /org/:orgId/invitations`.
 *
 * Spec: `sdd/org-invitations/spec` R-Invitations-List. Tokens are
 * EXPLICITLY excluded — listing the token would defeat the email-only
 * delivery contract. `status` is hard-coded to `'PENDING'` because the
 * service filters non-PENDING rows out (see {@link InvitationsService.list}).
 * `acceptedAt` / `revokedAt` are always `null` for the same reason —
 * surfaced for shape stability across consumers (B7 web list).
 */
export interface InvitationListEntryDto {
  id: string;
  email: string;
  role: Role;
  status: 'PENDING';
  expiresAt: string;
  invitedById: string | null;
  invitedByName: string | null;
  acceptedAt: null;
  revokedAt: null;
  createdAt: string;
}

export interface InvitationsListResponseDto {
  invitations: InvitationListEntryDto[];
}

/**
 * Wire shape for `GET /invitations/:token` (public preview).
 *
 * Spec: `sdd/org-invitations/spec` R-Invitation-Preview "MUST NOT leak
 * email or org id". The shape contains ONLY display-safe fields — no
 * `id`, no `email`, no `organizationId`, no inviter `userId`/email.
 */
export interface InvitationPreviewResponseDto {
  orgName: string;
  orgSlug: string;
  inviterName: string | null;
  role: Role;
  expiresAt: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
}

/** Wire shape for `POST /invitations/:token/accept` 200 response. */
export interface AcceptInvitationResponseDto {
  orgId: string;
  role: Role;
}

/**
 * `InvitationsController` — HTTP surface for `sdd/org-invitations`
 * (MVP-3b3b).
 *
 * Two path families share one controller class because they share a
 * single service collaborator (`InvitationsService`) and there is no
 * benefit to splitting:
 *
 *   - `/org/:orgId/invitations[...]` — org-scoped routes guarded by the
 *     full guard chain (`Jwt → MembershipFreshness → OrgScope → Roles`).
 *   - `/invitations/:token[...]`     — token-addressed routes that DO
 *     NOT carry an `X-Org-Id`. These use `@Public()` (preview, anonymous
 *     OK) or `@PublicScope()` (accept, JWT required but no org scope).
 *
 * The class declares `@Controller()` with NO prefix; every handler uses
 * the absolute path. NestJS does not set a global prefix in this app
 * (state #697 confirms `setGlobalPrefix('api')` is intentionally NOT
 * used — the proxy mode #666 prepends `/api` at the web layer).
 *
 * Defence-in-depth: org-scoped handlers assert `:orgId === currentOrgId`
 * (mirroring `MembersController`). The actual security boundary is
 * `OrgScopeGuard`, which resolves the active org from `X-Org-Id`; the
 * assertion catches the pathological client that sends mismatched
 * `:orgId` and `X-Org-Id`.
 *
 * Foot-gun #667: explicit `@Inject(InvitationsService)` for the
 * constructor parameter — `tsx` does not emit `design:paramtypes`
 * decorator metadata so reflection-based DI cannot resolve class tokens.
 *
 * Spec: `sdd/org-invitations/spec`
 *   - R-Invitation-Issue, R-Invitations-List, R-Invitation-Revoke,
 *     R-Invitation-Preview, R-Invitation-Accept.
 * Design: `sdd/org-invitations/design` §0 #1-#3, §2 (HTTP surface).
 */
@Controller()
export class InvitationsController {
  constructor(@Inject(InvitationsService) private readonly service: InvitationsService) {}

  /**
   * `POST /org/:orgId/invitations` — issue (or re-issue) a PENDING invitation.
   *
   * Authorization: `@Roles('OWNER','ADMIN')`. The service further
   * enforces `OWNER_INVITE_REQUIRES_OWNER` (only OWNER may mint OWNER).
   *
   * Body validated by `ZodBodyPipe(issueInvitationSchema)` — loose at
   * the DTO layer; the service emits structured `INVALID_EMAIL` /
   * `INVALID_ROLE` codes per spec.
   *
   * Returns 201 with `{id, email, role, expiresAt, invitedById, status:'PENDING'}`.
   * The opaque token is INTENTIONALLY OMITTED — see {@link IssueInvitationResponseDto}.
   */
  @Post('org/:orgId/invitations')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.CREATED)
  async issue(
    @Param('orgId') orgId: string,
    @CurrentUser() user: AuthUser | undefined,
    @CurrentOrg() currentOrgId: string,
    @Body(new ZodBodyPipe(issueInvitationSchema)) body: IssueInvitationDto,
  ): Promise<IssueInvitationResponseDto> {
    if (!user) throw new UnauthorizedException('JWT required.');
    this.assertOrgScope(orgId, currentOrgId);
    const result = await this.service.issue(user, orgId, body);
    return {
      id: result.id,
      email: result.email,
      role: result.role,
      expiresAt: result.expiresAt.toISOString(),
      invitedById: result.invitedById,
      status: 'PENDING',
    };
  }

  /**
   * `GET /org/:orgId/invitations` — list PENDING invitations for the org.
   *
   * Any member of `:orgId` may list (no `@Roles(...)`): `OrgScopeGuard`
   * already verified membership. The service filters non-PENDING rows
   * via `computeInvitationStatus` (D8 — single source of truth for
   * status precedence).
   *
   * `Cache-Control: no-store` — the list mutates on every issue / revoke
   * / accept; stale UI is worse than the trivial cost of a fresh fetch.
   */
  @Get('org/:orgId/invitations')
  @Header('Cache-Control', 'no-store')
  async list(
    @Param('orgId') orgId: string,
    @CurrentOrg() currentOrgId: string,
  ): Promise<InvitationsListResponseDto> {
    this.assertOrgScope(orgId, currentOrgId);
    const rows = await this.service.list(orgId);
    return {
      invitations: rows.map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role,
        status: 'PENDING' as const,
        expiresAt: r.expiresAt.toISOString(),
        invitedById: r.invitedById,
        invitedByName: r.invitedByName,
        acceptedAt: null,
        revokedAt: null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * `DELETE /org/:orgId/invitations/:invitationId` — soft-revoke.
   *
   * Authorization: `@Roles('OWNER','ADMIN')`. The service:
   *   - 404 `INVITATION_NOT_FOUND` when the row belongs to a different
   *     org (cross-org leak protection).
   *   - 410 `ALREADY_ACCEPTED` when the row is terminal-accepted.
   *   - No-op (idempotent) when already REVOKED — preserves audit
   *     timestamp per spec R-Invitation-Revoke.
   *
   * Returns 204 No Content on success.
   */
  @Delete('org/:orgId/invitations/:invitationId')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Param('orgId') orgId: string,
    @Param('invitationId') invitationId: string,
    @CurrentOrg() currentOrgId: string,
  ): Promise<void> {
    this.assertOrgScope(orgId, currentOrgId);
    await this.service.revoke(orgId, invitationId);
  }

  /**
   * `GET /invitations/:token` — public preview by opaque token.
   *
   * `@Public()` short-circuits ALL guards — anonymous callers reach this
   * route. The response shape MUST NOT leak `id`, `email`, or `orgId`
   * (spec R-Invitation-Preview); see {@link InvitationPreviewResponseDto}.
   *
   * Non-PENDING → 410 with the matching `INVITATION_<STATUS>` code.
   * Unknown token → 404 `INVITATION_NOT_FOUND`. The service centralises
   * the mapping (`statusToCode`).
   *
   * `Cache-Control: no-store` — the preview embeds an `expiresAt` and
   * the underlying status can flip (REVOKED) at any time.
   */
  @Get('invitations/:token')
  @Public()
  @Header('Cache-Control', 'no-store')
  async preview(@Param('token') token: string): Promise<InvitationPreviewResponseDto> {
    const result = await this.service.preview(token);
    return {
      orgName: result.orgName,
      orgSlug: result.orgSlug,
      inviterName: result.inviterName,
      role: result.role,
      expiresAt: result.expiresAt.toISOString(),
      status: result.status,
    };
  }

  /**
   * `POST /invitations/:token/accept` — consume an invitation.
   *
   * `@PublicScope()` — JWT required (so `@CurrentUser()` is populated)
   * but `OrgScopeGuard` is skipped: the caller is by definition NOT yet
   * a member of the target org, so they can't possibly resolve an
   * `X-Org-Id` for it. `MembershipFreshnessGuard` STILL runs (it's
   * user-scoped, not org-scoped — by design).
   *
   * The service is the chokepoint: it validates the token state
   * (404/410), enforces `EMAIL_MISMATCH` (403), and routes the
   * INSERT-or-fetch through `MembersService.createOrGet` (architectural
   * invariant — the integration suite asserts this is the only path
   * that touches `prisma.membership.create`).
   *
   * NOTE on staleness: a fresh acceptor's JWT does NOT yet contain a
   * `Membership` for `:orgId` — that's expected. The web layer is
   * responsible for triggering a JWT refresh after this 200 response
   * (spec design §2 acceptance flow); the next request carries a JWT
   * that includes the new membership and `OrgScopeGuard` resolves it.
   */
  @Post('invitations/:token/accept')
  @PublicScope()
  @HttpCode(HttpStatus.OK)
  async accept(
    @Param('token') token: string,
    @CurrentUser() user: AuthUser | undefined,
  ): Promise<AcceptInvitationResponseDto> {
    if (!user) throw new UnauthorizedException('JWT required.');
    return this.service.accept(user, token);
  }

  /**
   * Defence-in-depth: the `:orgId` URL segment MUST equal the org
   * resolved by `OrgScopeGuard` (which gates on `X-Org-Id`). The guard
   * is the actual security boundary; this assertion catches the
   * pathological client that sends a `:orgId` different from its
   * `X-Org-Id` header — surfaces as 403 rather than letting the call
   * silently target the header-resolved org.
   */
  private assertOrgScope(orgIdParam: string, currentOrgId: string): void {
    if (currentOrgId !== orgIdParam) {
      throw new ForbiddenException('Path :orgId does not match resolved org scope');
    }
  }
}
