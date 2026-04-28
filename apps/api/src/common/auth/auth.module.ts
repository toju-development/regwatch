import { Global, Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { AuthStartupValidator } from './auth-startup.validator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtVerifier } from './jwt-verifier.js';
import { MembershipFreshnessGuard } from './membership-freshness.guard.js';
import { OrgScopeGuard } from './org-scope.guard.js';
import { RolesGuard } from './roles.guard.js';

/**
 * Registers the global auth chain for `apps/api`.
 *
 * - `JwtVerifier`: single shared `jose` HS256 verifier (caches secret bytes).
 * - `APP_GUARD` chain in **strict order** (NestJS executes APP_GUARDs in
 *   `providers[]` declaration order):
 *     1. {@link JwtAuthGuard}              — verify Bearer JWT,
 *                                            attach `request.user`,
 *                                            `request.jwtIat`,
 *                                            `request.jwtMv`
 *     2. {@link MembershipFreshnessGuard}  — compare `request.jwtMv`
 *                                            against live
 *                                            `User.membershipsVersion`
 *                                            (30s `(userId, jwtIat)`
 *                                            cache); 401
 *                                            `{code:'STALE_MEMBERSHIPS'}`
 *                                            on mismatch / missing.
 *                                            Added in B2 of
 *                                            `sdd/org-members`.
 *     3. {@link OrgScopeGuard}             — resolve `X-Org-Id` against
 *                                            `memberships[]`, attach
 *                                            `request.membership`
 *     4. {@link RolesGuard}                — enforce `@Roles(...)`
 *                                            ANY-of matrix
 *   Order is the contract — verified by `auth.module.order.spec.ts`.
 *
 * `MembershipFreshnessGuard` depends on `MembersService` +
 * `MEMBERSHIP_FRESHNESS_CACHE` + `MEMBERSHIP_FRESHNESS_TTL_MS`, all
 * provided by `MembersModule` (`@Global()`) — registered once in
 * `AppModule`. Cross-module DI succeeds because every constructor
 * parameter uses an explicit `@Inject(TOKEN)` (foot-gun #667).
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
 * Is Contract"; `sdd/org-members/spec` R-Jwt-Invalidate-Cross-User.
 * Design: `sdd/auth-authorization-guards/design` §1; `sdd/org-members/design` §3, §5.
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    JwtVerifier,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: MembershipFreshnessGuard },
    { provide: APP_GUARD, useClass: OrgScopeGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    AuthStartupValidator,
  ],
  exports: [JwtVerifier],
})
export class AuthModule {}
