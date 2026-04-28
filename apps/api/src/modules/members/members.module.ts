import { Global, Module } from '@nestjs/common';
import { env } from '../../env.js';
import { InMemoryFreshnessCache } from '../../common/auth/membership-freshness-cache.js';
import { MembersService } from './members.service.js';
import { PrismaMembersRepo } from './members.repo.js';
import {
  MEMBERS_REPO_TOKEN,
  MEMBERSHIP_FRESHNESS_CACHE,
  MEMBERSHIP_FRESHNESS_TTL_MS,
} from './tokens.js';

/**
 * `MembersModule` — domain home for membership reads/writes.
 *
 * Declared `@Global()` so `MembershipFreshnessGuard` (registered as an
 * `APP_GUARD` inside `AuthModule`) can `@Inject(MembersService)` and
 * `@Inject(MEMBERSHIP_FRESHNESS_CACHE)` across the module boundary
 * without an explicit `imports[]` round-trip in every consumer
 * (design §0 #4, §5).
 *
 * **B2 wiring (this commit):**
 *   - `MEMBERS_REPO_TOKEN` → `PrismaMembersRepo` (uses global
 *     `PrismaModule.PRISMA_CLIENT`).
 *   - `MembersService` (class provider; explicit `@Inject(MEMBERS_REPO_TOKEN)`
 *     in its constructor — foot-gun #667).
 *   - `MEMBERSHIP_FRESHNESS_CACHE` → singleton `InMemoryFreshnessCache`.
 *   - `MEMBERSHIP_FRESHNESS_TTL_MS` → `env.MEMBERSHIPS_FRESHNESS_TTL_MS`
 *     (default 30000, validated by `@t3-oss/env-core`).
 *
 * **B3 will add**: `MembersController`, DTOs, `RolesOrSelfGuard`, and
 * extend `MembersService` with the transactional `mutate()` chokepoint.
 *
 * Spec: `sdd/org-members/spec` R-Jwt-Invalidate-Cross-User.
 * Design: `sdd/org-members/design` §0 #4, §3, §5.
 */
@Global()
@Module({
  providers: [
    { provide: MEMBERS_REPO_TOKEN, useClass: PrismaMembersRepo },
    MembersService,
    { provide: MEMBERSHIP_FRESHNESS_CACHE, useValue: new InMemoryFreshnessCache() },
    { provide: MEMBERSHIP_FRESHNESS_TTL_MS, useValue: env.MEMBERSHIPS_FRESHNESS_TTL_MS },
  ],
  exports: [
    MembersService,
    MEMBERS_REPO_TOKEN,
    MEMBERSHIP_FRESHNESS_CACHE,
    MEMBERSHIP_FRESHNESS_TTL_MS,
  ],
})
export class MembersModule {}
