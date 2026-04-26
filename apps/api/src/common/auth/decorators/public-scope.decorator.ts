import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/**
 * Reflector metadata key flagged by routes that bypass `OrgScopeGuard`
 * AND `RolesGuard` but STILL require a valid JWT (`JwtAuthGuard` runs).
 *
 * Distinct from `IS_PUBLIC_KEY` (`@Public()`), which short-circuits ALL
 * three guards transitively.
 *
 * Spec: `sdd/auth-authorization-guards/spec` R "OrgScopeGuard Resolves
 * Active Organization" S "@PublicScope skips org check but requires JWT".
 */
export const IS_PUBLIC_SCOPE_KEY = 'isPublicScope';

/**
 * Marks a controller class or handler as scope-public — the request must
 * carry a valid JWT (so `@CurrentUser()` works), but no `X-Org-Id` is
 * required and no role is enforced. Use for endpoints that operate on
 * the principal alone (e.g. `/me`, account settings, org switcher).
 *
 * MUST NOT be combined with `@Roles(...)` for the same handler.
 *
 * Design: `sdd/auth-authorization-guards/design` §1 (decorator matrix, Q5).
 */
export const PublicScope = (): CustomDecorator<typeof IS_PUBLIC_SCOPE_KEY> =>
  SetMetadata(IS_PUBLIC_SCOPE_KEY, true);
