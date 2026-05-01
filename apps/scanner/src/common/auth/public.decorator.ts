// MVP-5: copy-pasted from apps/api/src/common/auth/. Extract to packages/auth-guards
// in MVP-13 when 4 new scanner apps need to reuse. MembershipFreshnessGuard
// intentionally NOT copied — see B5 apply-progress for reasoning.
import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/**
 * Reflector metadata key flagged by routes that should bypass
 * {@link JwtAuthGuard}. String key (not Symbol) so it survives
 * `Reflect.getMetadata` lookups across module boundaries.
 *
 * Spec: `sdd/auth-foundation/spec` R "@Public() Opt-out".
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a controller class or handler as publicly accessible — the
 * `JwtAuthGuard` short-circuits and returns `true` without inspecting
 * the `Authorization` header.
 *
 * In `apps/scanner` the only `@Public()` route is `/health`.
 */
export const Public = (): CustomDecorator<typeof IS_PUBLIC_KEY> => SetMetadata(IS_PUBLIC_KEY, true);
