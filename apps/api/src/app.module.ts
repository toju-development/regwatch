import { Module, type DynamicModule } from '@nestjs/common';
import { AuthModule } from './common/auth/auth.module.js';
import { HealthModule } from './health/health.module.js';
import { TestOnlyModule } from './common/auth/__test-only__/test-only.module.js';
import { env } from './env.js';

/**
 * Root Nest module.
 *
 * `TestOnlyModule` (the `_test/me` canary used by Playwright) is mounted
 * conditionally — NEVER in production. Spec: auth-foundation R "Protected
 * API Route via JwtAuthGuard" S "Valid token authorizes / Missing → 401".
 *
 * Returns `NonNullable<DynamicModule['imports']>` so the result satisfies
 * `ModuleMetadata.imports` under `exactOptionalPropertyTypes: true` (assigning
 * `T | undefined` to an optional property is rejected). Gating uses the typed
 * `env.NODE_ENV` (validated 'development' | 'test' | 'production') instead of
 * raw `process.env.NODE_ENV`.
 */
function conditionalImports(): NonNullable<DynamicModule['imports']> {
  const base: NonNullable<DynamicModule['imports']> = [AuthModule, HealthModule];
  if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') {
    base.push(TestOnlyModule);
  }
  return base;
}

@Module({
  imports: conditionalImports(),
})
export class AppModule {}
