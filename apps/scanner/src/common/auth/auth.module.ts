// MVP-5: scanner-local auth module. Mirrors apps/api/AuthModule but does NOT
// register guards as global APP_GUARDs — `apps/scanner` only protects ONE
// endpoint (`POST /scan/trigger`), so guards are applied per-controller via
// `@UseGuards(JwtAuthGuard, RolesGuard)`.
//
// MembershipFreshnessGuard + OrgScopeGuard intentionally NOT included here —
// see B5 apply-progress / roles.guard.ts deviation header.
//
// Extract to packages/auth-guards in MVP-13.
import { Global, Module } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtVerifier } from './jwt-verifier.js';
import { RolesGuard } from './roles.guard.js';

@Global()
@Module({
  providers: [JwtVerifier, JwtAuthGuard, RolesGuard],
  exports: [JwtVerifier, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
