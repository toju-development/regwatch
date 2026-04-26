import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Role } from '@regwatch/types';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { IS_PUBLIC_SCOPE_KEY } from './decorators/public-scope.decorator.js';
import { ROLES_KEY } from './decorators/roles.decorator.js';

/**
 * Globally-registered guard (B6 wires `APP_GUARD` in `AuthModule` AFTER
 * `OrgScopeGuard`). Enforces the `@Roles(...)` matrix on the resolved
 * membership attached by `OrgScopeGuard`.
 *
 * Semantics: **ANY-of** — caller passes if their `request.membership.role`
 * is in the declared `@Roles(...)` list.
 *
 * Short-circuit cases:
 * - `@Public()` (`IS_PUBLIC_KEY`) → returns `true` (defensive — transitive
 *   bypass already enforced by `JwtAuthGuard`/`OrgScopeGuard`).
 * - `@PublicScope()` (`IS_PUBLIC_SCOPE_KEY`) → returns `true` (no org
 *   context resolved, so role check is vacuous).
 * - No `@Roles(...)` declared (metadata absent or empty array) → returns
 *   `true` (route has no role restriction).
 *
 * Failure modes:
 * - `request.membership` missing on a non-public route declaring `@Roles`
 *   → `InternalServerErrorException` (defensive — indicates wiring bug:
 *   `OrgScopeGuard` did not run before `RolesGuard`).
 * - `request.membership.role` not in declared roles → `ForbiddenException`.
 *
 * Constructor uses explicit `@Inject(Reflector)` because the runtime is
 * `tsx` (esbuild) which does NOT emit `design:paramtypes` metadata —
 * carry-forward from MVP-1 tsx+DI decision (engram #628).
 *
 * Spec: `sdd/auth-authorization-guards/spec` R "RolesGuard Enforces Role Matrix".
 * Design: `sdd/auth-authorization-guards/design` §1 (guard order, decorator
 * matrix, ANY-of semantics).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) return true;

    const isPublicScope = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_SCOPE_KEY, targets);
    if (isPublicScope) return true;

    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (!requiredRoles || requiredRoles.length === 0) {
      // No `@Roles(...)` declared (or declared empty) → no restriction.
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { membership?: { role: Role } }>();

    if (!request.membership) {
      // Defensive: OrgScopeGuard must run before RolesGuard and attach
      // `request.membership`. Reaching here means provider order was
      // misconfigured (B6 contract) — fail loud so it surfaces in tests.
      throw new InternalServerErrorException('OrgScopeGuard must run before RolesGuard');
    }

    if (!requiredRoles.includes(request.membership.role)) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }
}
