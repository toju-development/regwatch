import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUser } from '@regwatch/types';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { CurrentOrg } from '../../common/auth/decorators/current-org.decorator.js';
import { PublicScope } from '../../common/auth/decorators/public-scope.decorator.js';
import { Roles } from '../../common/auth/decorators/roles.decorator.js';
import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe.js';
import { createOrgSchema, type CreateOrgDto } from './dto/create-org.dto.js';
import { updateOrgSchema, type UpdateOrgDto } from './dto/update-org.dto.js';
import type { MeResponseDto } from './dto/me-response.dto.js';
import { OrganizationsService } from './organizations.service.js';

/**
 * `/org` controller — both routes are `@PublicScope()` (JWT required, no
 * `X-Org-Id` required). Spec: R-Org-GetMe + R-OrgCreate. Design §2.
 *
 * - `GET /org/me` — `Cache-Control: no-store` (decision #3 — `memberships[]`
 *   mutates on self-create + future invitations; staleness is a wrong-org
 *   bug). Client-side SWR de-dupes within a tab.
 * - `POST /org` — body validated via Zod, returns 201 with the created org.
 *
 * `@CurrentUser()` is guaranteed defined for `@PublicScope()` routes
 * (`JwtAuthGuard` runs); the defensive `UnauthorizedException` covers the
 * impossible "guard skipped at runtime" path and keeps the type narrowing
 * explicit under `noUncheckedIndexedAccess`.
 */
@Controller('org')
export class OrganizationsController {
  constructor(@Inject(OrganizationsService) private readonly service: OrganizationsService) {}

  @PublicScope()
  @Get('me')
  @Header('Cache-Control', 'no-store')
  async me(
    @CurrentUser() user: AuthUser | undefined,
    @Headers('x-org-id') xOrgIdRaw: string | undefined,
  ): Promise<MeResponseDto> {
    if (!user) {
      throw new UnauthorizedException('JWT required.');
    }
    const xOrgId =
      typeof xOrgIdRaw === 'string' && xOrgIdRaw.trim().length > 0 ? xOrgIdRaw.trim() : null;
    return this.service.getMe(user, xOrgId);
  }

  @PublicScope()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: AuthUser | undefined,
    @Body(new ZodBodyPipe(createOrgSchema)) body: CreateOrgDto,
  ): Promise<{ id: string; name: string; slug: string }> {
    if (!user) {
      throw new UnauthorizedException('JWT required.');
    }
    return this.service.create(user.userId, body.name);
  }

  /**
   * `PATCH /org/:orgId` — rename an existing organization.
   *
   * Locked to OWNER. The `OrgScopeGuard` (global) resolves `X-Org-Id`
   * against the JWT memberships; `@CurrentOrg()` exposes the resolved id.
   * `assertOrgScope` ensures the URL `:orgId` matches the header-resolved
   * org (defense-in-depth, identical pattern to `SettingsController`).
   *
   * Spec: `sdd/onboarding-redesign/spec` R-RenameOrg.
   * Design: `sdd/onboarding-redesign/design` — PATCH /org/:orgId.
   */
  @Patch(':orgId')
  @Roles('OWNER')
  @Header('Cache-Control', 'no-store')
  async rename(
    @Param('orgId') orgId: string,
    @CurrentOrg() currentOrgId: string,
    @Body(new ZodBodyPipe(updateOrgSchema)) body: UpdateOrgDto,
  ): Promise<{ id: string; name: string }> {
    this.assertOrgScope(orgId, currentOrgId);
    return this.service.rename(orgId, body.name);
  }

  /**
   * Defense-in-depth: 403 when the URL `:orgId` segment doesn't match
   * the org resolved by `OrgScopeGuard` from `X-Org-Id`. Mirrors
   * `SettingsController.assertOrgScope`.
   */
  private assertOrgScope(orgIdParam: string, currentOrgId: string): void {
    if (currentOrgId !== orgIdParam) {
      throw new ForbiddenException('Path :orgId does not match resolved org scope');
    }
  }
}
