import { SetMetadata, UseGuards, applyDecorators, type CustomDecorator } from '@nestjs/common';
import type { Role } from '@regwatch/types';
import { RolesOrSelfGuard } from '../roles-or-self.guard.js';

/**
 * Reflector metadata key consumed by {@link RolesOrSelfGuard}. String key
 * (not Symbol) so `Reflect.getMetadata` lookups survive across module
 * boundaries.
 */
export const ROLES_OR_SELF_KEY = 'rolesOrSelf';

/**
 * Restrict a route to callers whose `request.membership.role` is in the
 * declared list **OR** whose `request.user.userId` equals the URL param
 * `:userId` (self-target rule per `sdd/org-members/spec` Q8).
 *
 * Composable: declares the metadata AND wires the parameter-aware
 * {@link RolesOrSelfGuard} via `@UseGuards`. Because the guard runs at
 * handler level (AFTER the global `APP_GUARD` chain), `request.user` and
 * `request.membership` are guaranteed populated by `JwtAuthGuard` and
 * `OrgScopeGuard` respectively.
 *
 * The global {@link RolesGuard} treats absent `ROLES_KEY` as "no
 * restriction" and short-circuits to `true` — that's by design here, so
 * `@RolesOrSelf(...)` cleanly **replaces** `@Roles(...)` on the two
 * mutating member endpoints (design §0 #2 decision-correction).
 *
 * Spec: `sdd/org-members/spec` R-Membership-Update, R-Membership-Remove
 *   (Q8 self-target rule).
 * Design: `sdd/org-members/design` §0 #2, §2.
 */
export function RolesOrSelf(
  ...roles: Role[]
): CustomDecorator<typeof ROLES_OR_SELF_KEY> & MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(ROLES_OR_SELF_KEY, roles),
    UseGuards(RolesOrSelfGuard),
  ) as CustomDecorator<typeof ROLES_OR_SELF_KEY> & MethodDecorator & ClassDecorator;
}
