import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUser } from '@regwatch/types';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { PublicScope } from '../../common/auth/decorators/public-scope.decorator.js';
import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe.js';
import { createOrgSchema, type CreateOrgDto } from './dto/create-org.dto.js';
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
}
