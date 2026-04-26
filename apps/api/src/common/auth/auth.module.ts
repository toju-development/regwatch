import { Global, Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { AuthStartupValidator } from './auth-startup.validator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtVerifier } from './jwt-verifier.js';
import { OrgScopeGuard } from './org-scope.guard.js';
import { RolesGuard } from './roles.guard.js';

/**
 * Registers the global auth chain for `apps/api`.
 *
 * - `JwtVerifier`: single shared `jose` HS256 verifier (caches secret bytes).
 * - `APP_GUARD` chain in **strict order** (NestJS executes APP_GUARDs in
 *   `providers[]` declaration order):
 *     1. {@link JwtAuthGuard}   — verify Bearer JWT, attach `request.user`
 *     2. {@link OrgScopeGuard}  — resolve `X-Org-Id` against `memberships[]`,
 *                                 attach `request.membership`
 *     3. {@link RolesGuard}     — enforce `@Roles(...)` ANY-of matrix
 *   Order is the contract — verified by `auth.module.order.spec.ts`.
 *
 * - {@link AuthStartupValidator}: `OnModuleInit` hook that walks every
 *   discovered controller handler and throws if any combine `@Public()`
 *   with `@Roles(...)` (design §1 decorator matrix — degenerate combo).
 *   Imports `DiscoveryModule` so the validator can resolve `DiscoveryService`.
 *
 * `@Global()` keeps `JwtVerifier` injectable everywhere without re-imports
 * (used by future endpoints that issue/refresh tokens).
 *
 * Spec: `sdd/auth-authorization-guards/spec` R "Guard Registration Order
 * Is Contract".
 * Design: `sdd/auth-authorization-guards/design` §1 (guard order, startup
 * validation, decorator matrix).
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    JwtVerifier,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: OrgScopeGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    AuthStartupValidator,
  ],
  exports: [JwtVerifier],
})
export class AuthModule {}
