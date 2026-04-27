import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
  UsePipes,
  type PipeTransform,
} from '@nestjs/common';
import type { ZodType } from 'zod';
import type { AuthUser } from '@regwatch/types';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { PublicScope } from '../../common/auth/decorators/public-scope.decorator.js';
import { createOrgSchema, type CreateOrgDto } from './dto/create-org.dto.js';
import type { MeResponseDto } from './dto/me-response.dto.js';
import { OrganizationsService } from './organizations.service.js';

/**
 * Minimal Zod 4 → Nest validation pipe.
 *
 * Kept inline (not factored to `common/`) until a second module needs it —
 * YAGNI. Throws `BadRequestException` on parse failure with the flattened
 * `ZodError.issues` for client-friendly diagnostics.
 *
 * Spec: `sdd/org-membership-ux/spec` R-OrgCreate "Empty/oversize name → 400".
 */
class ZodBodyPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues,
      });
    }
    return result.data;
  }
}

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
  constructor(private readonly service: OrganizationsService) {}

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
  @UsePipes(new ZodBodyPipe(createOrgSchema))
  async create(
    @CurrentUser() user: AuthUser | undefined,
    @Body() body: CreateOrgDto,
  ): Promise<{ id: string; name: string; slug: string }> {
    if (!user) {
      throw new UnauthorizedException('JWT required.');
    }
    return this.service.create(user.userId, body.name);
  }
}
