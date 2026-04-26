import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser } from '@regwatch/types';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { IS_PUBLIC_SCOPE_KEY } from './decorators/public-scope.decorator.js';

const X_ORG_ID_HEADER = 'x-org-id';

/**
 * Globally-registered guard (B6 wires `APP_GUARD` in `AuthModule` AFTER
 * `JwtAuthGuard`, BEFORE `RolesGuard`). Resolves the active organization
 * from the `X-Org-Id` request header against the JWT `memberships[]`
 * claim and attaches the resolved `Membership` to `request.membership`.
 *
 * Short-circuit cases:
 * - `@Public()` (`IS_PUBLIC_KEY`) → returns `true` (defensive — `JwtAuthGuard`
 *   should already have skipped, but safe regardless of registration order).
 * - `@PublicScope()` (`IS_PUBLIC_SCOPE_KEY`) → returns `true` (auth still
 *   enforced by `JwtAuthGuard`; org-scope check intentionally bypassed).
 *
 * Failure modes:
 * - No `request.user` (defensive — `JwtAuthGuard` skipped or didn't run)
 *   → `UnauthorizedException`.
 * - Missing/empty `X-Org-Id` header → `ForbiddenException`.
 * - `X-Org-Id` not in `request.user.memberships[]` → `ForbiddenException`.
 *
 * Constructor uses explicit `@Inject(Reflector)` because the runtime is
 * `tsx` (esbuild) which does NOT emit `design:paramtypes` metadata —
 * carry-forward from MVP-1 tsx+DI decision (engram #628).
 *
 * Spec: `sdd/auth-authorization-guards/spec` R "OrgScopeGuard Resolves
 * Active Organization".
 * Design: `sdd/auth-authorization-guards/design` §1 (guard order, request
 * augmentation, decorator matrix).
 */
@Injectable()
export class OrgScopeGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const isPublicScope = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublicScope) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();

    if (!request.user) {
      // Defensive: should be set by JwtAuthGuard upstream. Only reachable
      // if guard ordering is misconfigured or upstream skipped on a
      // non-`@Public()` route.
      throw new UnauthorizedException('Authenticated user not resolved');
    }

    const xOrgId = this.extractOrgIdHeader(request);
    if (!xOrgId) {
      throw new ForbiddenException('X-Org-Id header required');
    }

    const membership = request.user.memberships.find((m) => m.organizationId === xOrgId);
    if (!membership) {
      throw new ForbiddenException('Not a member of organization');
    }

    request.membership = {
      organizationId: membership.organizationId,
      role: membership.role,
      orgSlug: membership.orgSlug,
    };
    return true;
  }

  private extractOrgIdHeader(request: Request): string | undefined {
    // Express normalizes header names to lower-case. Accept the raw value
    // if a downstream framework hands us a case-preserving headers bag.
    const raw = request.headers[X_ORG_ID_HEADER] ?? request.headers['X-Org-Id' as 'x-org-id'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }
}
