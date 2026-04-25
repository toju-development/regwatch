import { Module, type DynamicModule } from '@nestjs/common';
import { AuthModule } from './common/auth/auth.module.js';
import { HealthModule } from './health/health.module.js';
import { TestOnlyModule } from './common/auth/__test-only__/test-only.module.js';

/**
 * Root Nest module.
 *
 * `TestOnlyModule` (the `_test/me` canary used by Playwright) is mounted
 * conditionally — NEVER in production. Spec: auth-foundation R "Protected
 * API Route via JwtAuthGuard" S "Valid token authorizes / Missing → 401".
 */
function conditionalImports(): DynamicModule['imports'] {
  const base: NonNullable<DynamicModule['imports']> = [AuthModule, HealthModule];
  if (process.env.NODE_ENV !== 'production') {
    base.push(TestOnlyModule);
  }
  return base;
}

@Module({
  imports: conditionalImports(),
})
export class AppModule {}
