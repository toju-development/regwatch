import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { Role } from '@regwatch/types';

/**
 * Reflector metadata key consumed by {@link RolesGuard}. String key (not
 * Symbol) so `Reflect.getMetadata` lookups survive across module boundaries.
 *
 * Spec: `sdd/auth-authorization-guards/spec` R "RolesGuard Enforces Role Matrix".
 */
export const ROLES_KEY = 'roles';

/**
 * Restricts a route (or controller class) to callers whose resolved
 * `Membership.role` (attached by `OrgScopeGuard`) is in the allowed list.
 *
 * Semantics: **ANY-of** — the user passes if their role matches at least
 * one of the listed roles. `@Roles('OWNER','ADMIN')` allows either.
 *
 * Combination rules (locked in design §1):
 * - `@Public()` short-circuits ALL guards (transitive); combined with
 *   `@Roles(...)` it triggers a startup-time error in `AuthModule`.
 * - `@PublicScope()` skips `OrgScopeGuard` AND `RolesGuard`.
 *
 * Design: `sdd/auth-authorization-guards/design` §1 (decorator matrix).
 */
export const Roles = (...roles: Role[]): CustomDecorator<typeof ROLES_KEY> =>
  SetMetadata(ROLES_KEY, roles);
