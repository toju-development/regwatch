import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Param,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUser } from '@regwatch/types';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { CurrentOrg } from '../../common/auth/decorators/current-org.decorator.js';
import { Roles } from '../../common/auth/decorators/roles.decorator.js';
import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe.js';
import { toSettingsDto, type SettingsResponseDto } from './dto/settings-response.dto.js';
import { UpdateSettingsSchema, type UpdateSettingsInput } from './dto/update-settings.dto.js';
import { SettingsService } from './settings.service.js';

/**
 * `/org/:orgId/settings` HTTP surface for `sdd/jurisdictions-config`
 * (MVP-4 B3).
 *
 * Mounted at the NestJS-native path `/org/:orgId/settings`. The browser
 * hits these endpoints via PROXY MODE (#666) at
 * `/api/org/:orgId/settings` (web layer prepends `/api`; the API has
 * NO `setGlobalPrefix('api')` — see discovery `apps-api-no-global-prefix`).
 *
 * Guard chain (per design §2 / mirroring `MembersController`):
 *   1. {@link JwtAuthGuard}              — verifies the Bearer JWT.
 *   2. {@link MembershipFreshnessGuard}  — 401 `STALE_MEMBERSHIPS` on
 *      stale `mv` claim.
 *   3. {@link OrgScopeGuard}             — resolves `X-Org-Id` against
 *      `memberships[]` and attaches `request.membership`.
 *   4. {@link RolesGuard}                — short-circuits to `true` when
 *      the handler declares no `@Roles(...)`. GET intentionally has no
 *      `@Roles` (any member of the org may read); PUT declares
 *      `@Roles('OWNER','ADMIN')` per spec R-Settings-Update.
 *
 * Defense-in-depth (`assertOrgScope`): the `:orgId` URL segment MUST
 * equal the org resolved by `OrgScopeGuard` (which gates on the
 * `X-Org-Id` header). The guard is the actual security boundary; this
 * assertion catches the pathological client that sends a `:orgId`
 * different from its `X-Org-Id` header — surfaces as 403 rather than
 * letting the call silently target the header-resolved org. Identical
 * pattern to `MembersController.assertOrgScope` and
 * `InvitationsController.assertOrgScope`.
 *
 * Constructor uses explicit `@Inject(SettingsService)` per foot-gun #667
 * (tsx + NestJS DI requires explicit tokens; tsx's esbuild transformer
 * does not emit `design:paramtypes` metadata).
 *
 * Spec: `sdd/jurisdictions-config/spec`
 *   - R-Settings-Get-Or-Create
 *   - R-Settings-Update
 *   - R-Settings-Validation
 *   - R-Settings-Updated-Event
 * Design: `sdd/jurisdictions-config/design` §0 D5/D6/D8/D13, §2, §6.
 */
@Controller()
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly service: SettingsService) {}

  /**
   * `GET /org/:orgId/settings` — read the per-org settings, lazily
   * creating the row with `DEFAULT_SETTINGS` (7-LatAm) on first read.
   *
   * Open to any member of `:orgId` (no `@Roles(...)`): `OrgScopeGuard`
   * already verified the caller has SOME membership in `:orgId` — the
   * spec calls this "read = any member" (analogous to GET members).
   *
   * `Cache-Control: no-store` — settings mutate on PUT and the client
   * MUST always see the persisted state (no shared/intermediary cache).
   */
  @Get('org/:orgId/settings')
  @Header('Cache-Control', 'no-store')
  async get(
    @Param('orgId') orgId: string,
    @CurrentOrg() currentOrgId: string,
  ): Promise<SettingsResponseDto> {
    this.assertOrgScope(orgId, currentOrgId);
    const row = await this.service.getOrCreate(orgId);
    return { settings: toSettingsDto(row) };
  }

  /**
   * `PUT /org/:orgId/settings` — full-replace the settings (no PATCH per
   * design D8). Locked to OWNER + ADMIN (spec R-Settings-Update).
   *
   * Body validation runs through `ZodBodyPipe(UpdateSettingsSchema)` —
   * the canonical schema from `@regwatch/types` (foot-gun #667 / single
   * source). Failures surface as 400 with `{ message, issues }`; the
   * service is never called and no event fires.
   *
   * On success the service emits `settings.updated` POST-commit (design
   * D13). A throwing listener does NOT roll back the persisted row.
   */
  @Put('org/:orgId/settings')
  @Roles('OWNER', 'ADMIN')
  @Header('Cache-Control', 'no-store')
  async update(
    @Param('orgId') orgId: string,
    @CurrentUser() user: AuthUser | undefined,
    @CurrentOrg() currentOrgId: string,
    @Body(new ZodBodyPipe(UpdateSettingsSchema)) body: UpdateSettingsInput,
  ): Promise<SettingsResponseDto> {
    if (!user) throw new UnauthorizedException('JWT required.');
    this.assertOrgScope(orgId, currentOrgId);
    const row = await this.service.update(orgId, body, user.userId);
    return { settings: toSettingsDto(row) };
  }

  /**
   * Defense-in-depth: 403 when the URL `:orgId` segment doesn't match
   * the org resolved by `OrgScopeGuard` from `X-Org-Id`. Why 403 (not
   * 400): the caller IS authenticated and IS a member of `currentOrgId`
   * — they're simply not authorized to act on `:orgId` (a DIFFERENT org
   * from their resolved scope). Identical reasoning to
   * `MembersController.assertOrgScope`.
   */
  private assertOrgScope(orgIdParam: string, currentOrgId: string): void {
    if (currentOrgId !== orgIdParam) {
      throw new ForbiddenException('Path :orgId does not match resolved org scope');
    }
  }
}
