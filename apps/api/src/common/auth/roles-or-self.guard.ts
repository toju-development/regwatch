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
import type { AuthUser, Role } from '@regwatch/types';
import { ROLES_OR_SELF_KEY } from './decorators/roles-or-self.decorator.js';

/**
 * Parameter-aware guard that powers `@RolesOrSelf(...roles)`.
 *
 * Allows the request when EITHER:
 *
 *   1. `request.membership.role` is in the declared roles list — same
 *      ANY-of semantics as {@link RolesGuard}, OR
 *   2. `request.user.userId === request.params.userId` — the caller is
 *      acting on their own membership (self-target — spec Q8 covers
 *      self-downgrade and self-leave).
 *
 * Wired at handler level via `@UseGuards(RolesOrSelfGuard)` from inside
 * the {@link RolesOrSelf} decorator factory; runs AFTER the global
 * `APP_GUARD` chain (`JwtAuthGuard` → `MembershipFreshnessGuard` →
 * `OrgScopeGuard` → `RolesGuard`). The global `RolesGuard` has already
 * passed by the time we run because the route declares no `ROLES_KEY`
 * metadata (`@RolesOrSelf` intentionally does NOT set it — design §0 #2).
 *
 * Failure modes:
 *   - Missing `ROLES_OR_SELF_KEY` metadata → defensive
 *     `InternalServerErrorException` (the decorator both wires the guard
 *     and stamps the key — a missing key here means the guard was
 *     attached manually without the decorator).
 *   - No `request.membership` → defensive `InternalServerErrorException`
 *     (means `OrgScopeGuard` did not run upstream).
 *   - Neither role-match nor self-target → `ForbiddenException`.
 *
 * Foot-gun #667 (tsx + NestJS DI): explicit `@Inject(Reflector)`.
 *
 * Spec: `sdd/org-members/spec` R-Membership-Update, R-Membership-Remove.
 * Design: `sdd/org-members/design` §0 #2, §2.
 */
@Injectable()
export class RolesOrSelfGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    const allowedRoles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_OR_SELF_KEY,
      targets,
    );
    if (!allowedRoles) {
      throw new InternalServerErrorException(
        'RolesOrSelfGuard requires @RolesOrSelf(...) metadata',
      );
    }

    const request = context.switchToHttp().getRequest<
      Request & {
        user?: AuthUser;
        membership?: { role: Role; organizationId: string };
      }
    >();

    if (!request.user || !request.membership) {
      throw new InternalServerErrorException('OrgScopeGuard must run before RolesOrSelfGuard');
    }

    // 1. Self-target rule — caller acting on their own membership row.
    const targetUserId = this.extractTargetUserId(request);
    if (targetUserId && request.user.userId === targetUserId) {
      return true;
    }

    // 2. ANY-of role check.
    if (allowedRoles.includes(request.membership.role)) {
      return true;
    }

    throw new ForbiddenException('Insufficient role for cross-user write');
  }

  /**
   * Extract `:userId` from the URL params bag. Returns `undefined` when
   * the route does not declare a `:userId` segment — in which case the
   * self-target branch never matches and the role check is the only
   * gate (effectively reduces to `@Roles(...)` semantics).
   */
  private extractTargetUserId(request: Request): string | undefined {
    const params = request.params as Record<string, string | undefined> | undefined;
    const value = params?.['userId'];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}
