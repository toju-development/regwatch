import type { AuthUser, Role } from '@regwatch/types';

/**
 * Global augmentation of `Express.Request` with auth-resolved fields.
 *
 * - `user`: attached by `JwtAuthGuard` after JWT verification (claims).
 * - `membership`: attached by `OrgScopeGuard` after resolving the
 *   `X-Org-Id` header against the JWT `memberships[]` claim.
 * - `jwtIat`: attached by `JwtAuthGuard` — verified `iat` claim. Consumed
 *   by `MembershipFreshnessGuard` (sdd/org-members B2) as part of the
 *   `(userId, jwtIat)` cache key.
 * - `jwtMv`: attached by `JwtAuthGuard` — verified `mv` (memberships
 *   version) claim. Compared against `User.membershipsVersion` by
 *   `MembershipFreshnessGuard`. Optional because pre-3b3a JWTs do not
 *   carry the claim (they're treated as STALE by the freshness guard).
 *
 * Both fields are optional at the type level because:
 * - `@Public()` routes skip both guards → both undefined.
 * - `@PublicScope()` routes skip OrgScopeGuard → `membership` undefined.
 *
 * Spec: `sdd/auth-authorization-guards/spec` R "OrgScopeGuard Resolves
 * Active Organization"; `sdd/org-members/spec` R-Jwt-Invalidate-Cross-User.
 * Design: `sdd/auth-authorization-guards/design` §1; `sdd/org-members/design` §3.
 *
 * Picked up via `apps/api/tsconfig.json` `include: ["src/**\/*"]`.
 */
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      membership?: {
        organizationId: string;
        role: Role;
        orgSlug: string;
      };
      jwtIat?: number;
      jwtMv?: number;
    }
  }
}

export {};
