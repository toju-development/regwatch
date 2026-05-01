// MVP-5: ADAPTED from apps/api/src/common/auth/roles.guard.ts.
// Extract to packages/auth-guards in MVP-13.
//
// DEVIATION FROM API VERSION (intentional, locked by orchestrator brief):
//   The api-side RolesGuard depends on `request.membership` set by
//   OrgScopeGuard. In `apps/scanner` we DO NOT copy OrgScopeGuard (would
//   pull MembershipFreshnessGuard transitively → MembersService → 200+ LOC).
//   Instead this guard extracts `organizationId` directly from the request
//   body (POST) or params (future GET) and resolves the caller's role from
//   `request.user.memberships[]` set by JwtAuthGuard.
//
// MembershipFreshnessGuard intentionally NOT copied — JWT freshness is
// enforced by the api side; the scanner only exposes one DEPRECATED-IN-MVP-12
// endpoint and accepts the slightly-stale-membership window as acceptable
// risk for MVP-5.
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser, Role } from '@regwatch/types';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { ROLES_KEY } from './decorators/roles.decorator.js';

/**
 * Resolves caller role for the requested `organizationId` and enforces the
 * `@Roles(...)` ANY-of matrix.
 *
 * `organizationId` extraction order: `request.body.organizationId` →
 * `request.params.organizationId` → `request.params.orgId`.
 *
 * Failure modes:
 *  - `@Public()` → returns true (defensive — JwtAuthGuard already bypassed).
 *  - No `@Roles(...)` declared → returns true (no restriction).
 *  - `request.user` missing → ForbiddenException (JwtAuthGuard MUST run first).
 *  - `organizationId` not extractable → ForbiddenException.
 *  - Caller has no membership for that org → ForbiddenException.
 *  - Role not in declared list → ForbiddenException.
 *
 * tsx + NestJS DI requires explicit `@Inject(Reflector)` (foot-gun #667).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) return true;

    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<
      Request & {
        user?: AuthUser;
        body?: { organizationId?: unknown };
        params?: { organizationId?: string; orgId?: string };
      }
    >();

    if (!request.user) {
      throw new ForbiddenException('JwtAuthGuard must run before RolesGuard');
    }

    const orgId = this.extractOrgId(request);
    if (!orgId) {
      throw new ForbiddenException('organizationId missing from request');
    }

    const membership = request.user.memberships.find((m) => m.organizationId === orgId);
    if (!membership) {
      throw new ForbiddenException('No membership for this organization');
    }

    if (!requiredRoles.includes(membership.role)) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }

  private extractOrgId(request: {
    body?: { organizationId?: unknown };
    params?: { organizationId?: string; orgId?: string };
  }): string | undefined {
    const fromBody = request.body?.organizationId;
    if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody;
    const fromParams = request.params?.organizationId ?? request.params?.orgId;
    if (typeof fromParams === 'string' && fromParams.length > 0) return fromParams;
    return undefined;
  }
}
