import type { AuthUser, Role } from '@regwatch/types';

/**
 * Global augmentation of `Express.Request` with auth-resolved fields.
 *
 * - `user`: attached by `JwtAuthGuard` after JWT verification (claims).
 * - `membership`: attached by `OrgScopeGuard` after resolving the
 *   `X-Org-Id` header against the JWT `memberships[]` claim.
 *
 * Both fields are optional at the type level because:
 * - `@Public()` routes skip both guards → both undefined.
 * - `@PublicScope()` routes skip OrgScopeGuard → `membership` undefined.
 *
 * Spec: `sdd/auth-authorization-guards/spec` R "OrgScopeGuard Resolves
 * Active Organization".
 * Design: `sdd/auth-authorization-guards/design` §1 (request augmentation).
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
    }
  }
}

export {};
