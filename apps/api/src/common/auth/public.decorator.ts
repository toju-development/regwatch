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
 * globally-registered `JwtAuthGuard` short-circuits and returns `true`
 * without inspecting the `Authorization` header.
 *
 * Use sparingly. `/health` is the canonical example.
 */
export const Public = (): CustomDecorator<typeof IS_PUBLIC_KEY> => SetMetadata(IS_PUBLIC_KEY, true);
