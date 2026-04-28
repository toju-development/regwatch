import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser } from '@regwatch/types';
import { MembersService } from '../../modules/members/members.service.js';
import {
  MEMBERSHIP_FRESHNESS_CACHE,
  MEMBERSHIP_FRESHNESS_TTL_MS,
} from '../../modules/members/tokens.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { buildFreshnessKey, type FreshnessCache } from './membership-freshness-cache.js';

/**
 * The structured 401 body that surfaces when the verified JWT carries
 * a stale `mv` claim (or no `mv` at all — pre-3b3a tokens). The web-side
 * `apiFetch` wrapper (B5) matches on `code === 'STALE_MEMBERSHIPS'` to
 * trigger NextAuth `update({})` + a single retry.
 *
 * Exported as a constant so unit tests can assert the wire shape
 * verbatim (and so the typo bus stays at one location).
 *
 * Spec: `sdd/org-members/spec` R-Jwt-Invalidate-Cross-User
 *   S "Stale JWT → 401 STALE_MEMBERSHIPS".
 * Design: `sdd/org-members/design` §0 #5, §3.
 */
export const STALE_MEMBERSHIPS_BODY = {
  code: 'STALE_MEMBERSHIPS' as const,
  message: 'Memberships claim is stale',
};

/**
 * Globally-registered `APP_GUARD` that runs AFTER `JwtAuthGuard` and
 * BEFORE `OrgScopeGuard` (R-Guard-Order — `capability/auth`). Compares
 * the verified JWT `mv` claim against the live
 * `User.membershipsVersion`; rejects with 401 `{ code:
 * 'STALE_MEMBERSHIPS' }` whenever they differ — including when `mv`
 * is absent (pre-3b3a JWTs that pre-date this slice).
 *
 * Caching: a `(userId, jwtIat)`-keyed in-memory map (TTL
 * `MEMBERSHIPS_FRESHNESS_TTL_MS`, default 30000) amortizes the
 * `User.membershipsVersion` SELECT — the spec scenario "Cache
 * amortizes per-request DB hit" demands at most ONE DB read per
 * `(userId, jwtIat)` per TTL window.
 *
 * Honors `@Public()` (returns `true` early, no DB hit). Does NOT
 * honor `@PublicScope()`: the spec is explicit that JWT freshness
 * MUST still be enforced even when org scope is bypassed.
 *
 * Foot-gun #667 (tsx + NestJS DI): every constructor parameter is
 * decorated with an explicit `@Inject(TOKEN)`. Without these tokens
 * the `tsx` (esbuild) transformer's missing `design:paramtypes`
 * metadata makes Nest's DI fail to resolve `Reflector`,
 * `MembersService`, the cache, or the TTL value.
 *
 * Spec: `sdd/org-members/spec` R-Jwt-Invalidate-Cross-User.
 * Design: `sdd/org-members/design` §0 #2-#5, §3.
 */
@Injectable()
export class MembershipFreshnessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(MembersService) private readonly members: MembersService,
    @Inject(MEMBERSHIP_FRESHNESS_CACHE) private readonly cache: FreshnessCache,
    @Inject(MEMBERSHIP_FRESHNESS_TTL_MS) private readonly ttlMs: number,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // `@Public()` short-circuits before any cache or DB hit. JwtAuthGuard
    // also short-circuits on this metadata, so by the time we run the
    // request has no `user` attached anyway — but the explicit check
    // makes the intent obvious and survives any future re-ordering.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<
      Request & {
        user?: AuthUser;
        jwtIat?: number;
        jwtMv?: number;
      }
    >();

    // Defensive: should be set by `JwtAuthGuard` upstream. Only reachable
    // if guard ordering is misconfigured. Returning `true` here lets the
    // downstream guard surface the real failure with the correct shape
    // rather than masking it with a STALE 401.
    if (!request.user) return true;

    const claimed = request.jwtMv;
    if (claimed === undefined) {
      // Pre-3b3a JWTs lack the `mv` claim — design §3 explicitly treats
      // these as STALE so the client's `apiFetch` retry path forces a
      // fresh re-mint via NextAuth `update({})`.
      throw new UnauthorizedException(STALE_MEMBERSHIPS_BODY);
    }

    const jwtIat = request.jwtIat ?? 0;
    const live = await this.getCachedVersion(request.user.userId, jwtIat);

    if (live !== claimed) {
      throw new UnauthorizedException(STALE_MEMBERSHIPS_BODY);
    }
    return true;
  }

  /**
   * Resolve the live `User.membershipsVersion` for `(userId, jwtIat)`
   * via cache, falling through to a single
   * `MembersService.getCurrentVersion(userId)` SELECT on miss/expiry.
   *
   * The cache itself enforces opportunistic eviction on read — by the
   * time `cache.get()` returns `undefined`, any expired entry has
   * already been deleted from the underlying map.
   */
  private async getCachedVersion(userId: string, jwtIat: number): Promise<number> {
    const key = buildFreshnessKey(userId, jwtIat);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached.version;

    const live = await this.members.getCurrentVersion(userId);
    this.cache.set(key, live, this.ttlMs);
    return live;
  }
}
