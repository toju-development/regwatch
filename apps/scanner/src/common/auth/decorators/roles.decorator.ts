// MVP-5: copy-pasted from apps/api/src/common/auth/decorators/. Extract to
// packages/auth-guards in MVP-13. See B5 apply-progress.
import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { Role } from '@regwatch/types';

/**
 * Reflector metadata key consumed by {@link RolesGuard}. String key (not
 * Symbol) so `Reflect.getMetadata` lookups survive across module boundaries.
 */
export const ROLES_KEY = 'roles';

/**
 * Restricts a route (or controller class) to callers whose membership for
 * the request's `organizationId` (extracted from body/params by the
 * scanner-local `RolesGuard`) is in the allowed list.
 *
 * Semantics: **ANY-of** — caller passes if their role matches at least one.
 */
export const Roles = (...roles: Role[]): CustomDecorator<typeof ROLES_KEY> =>
  SetMetadata(ROLES_KEY, roles);
