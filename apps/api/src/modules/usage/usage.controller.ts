import { Controller, ForbiddenException, Get, Header, Inject, Param } from '@nestjs/common';
import { CurrentOrg } from '../../common/auth/decorators/current-org.decorator.js';
import { toUsageResponseDto, type UsageResponseDto } from './dto/usage-response.dto.js';
import { UsageService } from './usage.service.js';

/**
 * `/org/:orgId/usage/current` HTTP surface for `sdd/scanner-vertical-ar`
 * (MVP-5 B6 / R-12).
 *
 * Mounted at the NestJS-native path `/org/:orgId/usage/current`. The
 * browser hits this endpoint via PROXY MODE (#666) at
 * `/api/org/:orgId/usage/current` (web layer prepends `/api`; the API
 * has NO `setGlobalPrefix('api')` — see discovery `apps-api-no-global-prefix`).
 *
 * Guard chain (per design ADR-11 / mirroring `SettingsController.get`):
 *   1. {@link JwtAuthGuard}              — verifies the Bearer JWT.
 *   2. {@link MembershipFreshnessGuard}  — 401 `STALE_MEMBERSHIPS` on
 *      stale `mv` claim.
 *   3. {@link OrgScopeGuard}             — resolves `X-Org-Id` against
 *      `memberships[]` and attaches `request.membership`.
 *   4. {@link RolesGuard}                — short-circuits to `true` when
 *      the handler declares no `@Roles(...)`. GET intentionally has no
 *      `@Roles` (any member of the org may read usage per R-12 / ADR-11
 *      "any role with org membership may read").
 *
 * Defense-in-depth (`assertOrgScope`): the `:orgId` URL segment MUST equal
 * the org resolved by `OrgScopeGuard` (which gates on the `X-Org-Id`
 * header). The guard is the actual security boundary; this assertion
 * catches the pathological client that sends a `:orgId` different from
 * its `X-Org-Id` header — surfaces as 403 rather than letting the call
 * silently target the header-resolved org. Identical pattern to
 * `SettingsController.assertOrgScope`, `MembersController.assertOrgScope`.
 *
 * Constructor uses explicit `@Inject(UsageService)` per foot-gun #667
 * (tsx + NestJS DI requires explicit tokens; tsx's esbuild transformer
 * does not emit `design:paramtypes` metadata).
 *
 * Spec: `sdd/scanner-vertical-ar/spec`
 *   - R-11-CanScanThisMonth (helper contract)
 *   - R-12-UsageReadEndpoint (4-guard chain, any-role read, Decimal-as-string)
 *   - R-13-UsageWidget (consumes this endpoint via PROXY MODE)
 * Design: `sdd/scanner-vertical-ar/design` ADR-11.
 */
@Controller()
export class UsageController {
  constructor(@Inject(UsageService) private readonly service: UsageService) {}

  /**
   * `GET /org/:orgId/usage/current` — return month-to-date usage for the
   * org (tokens, cost, scan count, cap, percent, isAtCap).
   *
   * Open to any member of `:orgId` (no `@Roles(...)`): `OrgScopeGuard`
   * already verified the caller has SOME membership in `:orgId` — R-12
   * spec scenario "VIEWER can read own-org usage" requires this.
   *
   * `Cache-Control: no-store` — the value mutates whenever a scan
   * commits (`apps/scanner`), and the widget MUST always reflect the
   * persisted state (no shared/intermediary cache). INV-UT-2 (no caching
   * MVP-5) is upheld at the wire level here.
   */
  @Get('org/:orgId/usage/current')
  @Header('Cache-Control', 'no-store')
  async get(
    @Param('orgId') orgId: string,
    @CurrentOrg() currentOrgId: string,
  ): Promise<UsageResponseDto> {
    this.assertOrgScope(orgId, currentOrgId);
    const usage = await this.service.getCurrent(orgId);
    return toUsageResponseDto(usage);
  }

  /**
   * Defense-in-depth: 403 when the URL `:orgId` segment doesn't match
   * the org resolved by `OrgScopeGuard` from `X-Org-Id`. Why 403 (not
   * 400): the caller IS authenticated and IS a member of `currentOrgId`
   * — they're simply not authorized to act on `:orgId` (a DIFFERENT org
   * from their resolved scope). Identical reasoning to
   * `SettingsController.assertOrgScope`.
   */
  private assertOrgScope(orgIdParam: string, currentOrgId: string): void {
    if (currentOrgId !== orgIdParam) {
      throw new ForbiddenException('Path :orgId does not match resolved org scope');
    }
  }
}
