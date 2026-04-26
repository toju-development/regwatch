import { Controller, Get } from '@nestjs/common';
import type { AuthUser, Role } from '@regwatch/types';
import { CurrentUser } from '../current-user.decorator.js';
import { CurrentOrg, CurrentRole } from '../decorators/current-org.decorator.js';
import { PublicScope } from '../decorators/public-scope.decorator.js';
import { Roles } from '../decorators/roles.decorator.js';
import { Public } from '../public.decorator.js';

/**
 * Test-only canary controller — exercises the full guard + decorator
 * matrix from design §1. Mounted ONLY when `NODE_ENV !== 'production'`
 * (see `app.module.ts`). Used by integration specs and Playwright.
 *
 * Endpoint matrix (all under `/_test`):
 *
 * | Path                     | Decorator(s)               | Guards that run         |
 * |--------------------------|----------------------------|-------------------------|
 * | `GET /me`                | (none — default)           | Jwt + OrgScope + Roles  |
 * | `GET /me/public`         | `@Public()`                | (all skipped)           |
 * | `GET /me/public-scope`   | `@PublicScope()`           | Jwt only                |
 * | `GET /me/owner-only`     | `@Roles('OWNER')`          | Jwt + OrgScope + Roles  |
 * | `GET /me/admin-or-owner` | `@Roles('OWNER','ADMIN')`  | Jwt + OrgScope + Roles  |
 *
 * Note (B6): `/me` is now subject to `OrgScopeGuard`, so it requires an
 * `X-Org-Id` header. The existing apps/web Playwright canary (`auth.spec.ts`)
 * will need either the header threaded through or an explicit `@PublicScope()`
 * marker — handled in B7 as part of the web edge middleware work.
 *
 * Spec: `sdd/auth-authorization-guards/spec` (all R's).
 * Design: `sdd/auth-authorization-guards/design` §1, §5 (test strategy).
 */
@Controller('_test')
export class MeController {
  /** Default — all 3 guards apply. Original B6 carry-over (MVP-3a canary). */
  @Get('me')
  me(@CurrentUser() user: AuthUser | undefined): { user: AuthUser | undefined } {
    return { user };
  }

  /** `@Public()` — bypasses Jwt, OrgScope, Roles transitively. */
  @Public()
  @Get('me/public')
  mePublic(): { ok: true } {
    return { ok: true };
  }

  /** `@PublicScope()` — Jwt runs, OrgScope + Roles skipped. */
  @PublicScope()
  @Get('me/public-scope')
  mePublicScope(@CurrentUser() user: AuthUser | undefined): { user: AuthUser | undefined } {
    return { user };
  }

  /** `@Roles('OWNER')` — single-role matrix (strict). */
  @Roles('OWNER')
  @Get('me/owner-only')
  meOwnerOnly(
    @CurrentOrg() orgId: string,
    @CurrentRole() role: Role,
  ): { orgId: string; role: Role } {
    return { orgId, role };
  }

  /** `@Roles('OWNER','ADMIN')` — ANY-of semantics (design §1). */
  @Roles('OWNER', 'ADMIN')
  @Get('me/admin-or-owner')
  meAdminOrOwner(
    @CurrentOrg() orgId: string,
    @CurrentRole() role: Role,
  ): { orgId: string; role: Role } {
    return { orgId, role };
  }
}
