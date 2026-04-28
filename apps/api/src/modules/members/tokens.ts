/**
 * DI tokens for `MembersModule`.
 *
 * Explicit `Symbol`-based tokens are mandatory under tsx + NestJS DI
 * (foot-gun #667): the `tsx` (esbuild) transformer does NOT emit
 * `design:paramtypes` metadata, so interface-typed constructor params
 * cannot be resolved by class. Every consumer pairs `@Inject(TOKEN)`
 * with one of these symbols.
 *
 * - {@link MEMBERS_REPO_TOKEN}: persistence boundary for the members
 *   module (`MembersRepo`). B2 only consumes
 *   `getUserMembershipsVersion`; B3 expands the contract for the
 *   transactional `mutate()` chokepoint.
 * - {@link MEMBERSHIP_FRESHNESS_CACHE}: in-memory `(userId, jwtIat)
 *   → version` cache used by `MembershipFreshnessGuard` to amortize
 *   the per-request `User.membershipsVersion` SELECT.
 * - {@link MEMBERSHIP_FRESHNESS_TTL_MS}: cache TTL (ms), wired from
 *   `env.MEMBERSHIPS_FRESHNESS_TTL_MS` (`@t3-oss/env-core`). Default
 *   30000.
 *
 * Spec: `sdd/org-members/spec` R-Jwt-Invalidate-Cross-User.
 * Design: `sdd/org-members/design` §0 #3-#4, §3, §5.
 */
export const MEMBERS_REPO_TOKEN = Symbol('MEMBERS_REPO_TOKEN');
export const MEMBERSHIP_FRESHNESS_CACHE = Symbol('MEMBERSHIP_FRESHNESS_CACHE');
export const MEMBERSHIP_FRESHNESS_TTL_MS = Symbol('MEMBERSHIP_FRESHNESS_TTL_MS');
