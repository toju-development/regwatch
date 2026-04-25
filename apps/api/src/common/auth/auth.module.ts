import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtVerifier } from './jwt-verifier.js';

/**
 * Registers JWT auth globally for `apps/api`.
 *
 * - `JwtVerifier`: single shared `jose` verifier (caches the secret bytes).
 * - `APP_GUARD` → `JwtAuthGuard`: every route is protected by default;
 *   opt-out via `@Public()` from `./public.decorator.js`.
 *
 * `@Global()` so `JwtVerifier` can be injected anywhere without re-importing
 * this module — useful for future endpoints that issue/refresh tokens.
 *
 * Design: `sdd/auth-foundation/design` §1 (architecture) + Q9.
 */
@Global()
@Module({
  providers: [
    JwtVerifier,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  exports: [JwtVerifier],
})
export class AuthModule {}
