import 'reflect-metadata';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@regwatch/types';
import { MembershipFreshnessGuard, STALE_MEMBERSHIPS_BODY } from '../membership-freshness.guard.js';
import { MembersService } from '../../../modules/members/members.service.js';
import {
  buildFreshnessKey,
  InMemoryFreshnessCache,
  type FreshnessCache,
} from '../membership-freshness-cache.js';

/**
 * Spec coverage matrix (`sdd/org-members/spec` R-Jwt-Invalidate-Cross-User):
 *
 *   S "Stale JWT → 401 STALE_MEMBERSHIPS"            → mvMismatch
 *   S "Fresh JWT after re-mint passes"               → mvMatch
 *   S "Cache amortizes per-request DB hit"           → cacheHit
 *   S "Cache TTL expiry triggers re-query"           → cacheExpiry
 *   + Pre-3b3a JWT (no `mv`) treated as STALE        → missingMv
 *   + `@Public()` bypasses the guard entirely        → publicBypass
 *   + Defensive: missing `request.user` → allow      → noUser
 *   + 401 body shape carries `code:STALE_MEMBERSHIPS`→ bodyShape
 *
 * Design: `sdd/org-members/design` §0 #2-#5, §3.
 */

interface FakeReq {
  user?: AuthUser;
  jwtIat?: number;
  jwtMv?: number;
}

function makeContext(req: FakeReq): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T>() => req as unknown as T,
      getResponse: <T>() => ({}) as T,
      getNext: <T>() => ({}) as T,
    }),
    getHandler: () => () => undefined,
    getClass: () => class Dummy {},
  } as unknown as ExecutionContext;
}

function makeReflector(isPublic: boolean): Reflector {
  return {
    getAllAndOverride: vi.fn().mockReturnValue(isPublic),
  } as unknown as Reflector;
}

function makeMembers(version: number): MembersService {
  return {
    getCurrentVersion: vi.fn().mockResolvedValue(version),
  } as unknown as MembersService;
}

const USER: AuthUser = {
  userId: 'user-1',
  email: 'a@b.com',
  memberships: [{ organizationId: 'o', orgSlug: 'o', role: 'OWNER' }],
  mv: 5,
};

describe('MembershipFreshnessGuard', () => {
  let cache: FreshnessCache;

  beforeEach(() => {
    cache = new InMemoryFreshnessCache();
  });

  it('bypasses the cache and DB entirely when @Public() metadata is present (publicBypass)', async () => {
    const members = makeMembers(99);
    const guard = new MembershipFreshnessGuard(makeReflector(true), members, cache, 30000);
    const ctx = makeContext({}); // no user, no claims — irrelevant for @Public

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(members.getCurrentVersion).not.toHaveBeenCalled();
  });

  it('returns true when request.user is absent (noUser — defensive, lets downstream surface real failure)', async () => {
    const members = makeMembers(99);
    const guard = new MembershipFreshnessGuard(makeReflector(false), members, cache, 30000);
    const ctx = makeContext({ jwtIat: 1, jwtMv: 1 });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(members.getCurrentVersion).not.toHaveBeenCalled();
  });

  it('returns true when claimed mv matches live version (mvMatch)', async () => {
    const members = makeMembers(5);
    const guard = new MembershipFreshnessGuard(makeReflector(false), members, cache, 30000);
    const ctx = makeContext({ user: USER, jwtIat: 1234, jwtMv: 5 });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(members.getCurrentVersion).toHaveBeenCalledTimes(1);
    expect(members.getCurrentVersion).toHaveBeenCalledWith('user-1');
  });

  it('throws 401 STALE_MEMBERSHIPS when claimed mv does NOT match live version (mvMismatch)', async () => {
    const members = makeMembers(8); // live ahead of claim
    const guard = new MembershipFreshnessGuard(makeReflector(false), members, cache, 30000);
    const ctx = makeContext({ user: USER, jwtIat: 1234, jwtMv: 5 });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws 401 STALE_MEMBERSHIPS when JWT lacks `mv` claim (missingMv — pre-3b3a token)', async () => {
    const members = makeMembers(0);
    const guard = new MembershipFreshnessGuard(makeReflector(false), members, cache, 30000);
    const ctx = makeContext({ user: USER, jwtIat: 1234 /* no jwtMv */ });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    // Pre-3b3a path MUST NOT touch the DB — STALE is a wire-shape decision,
    // not a data check (design §3).
    expect(members.getCurrentVersion).not.toHaveBeenCalled();
  });

  it('401 body carries `{ code: "STALE_MEMBERSHIPS", message: ... }` verbatim (bodyShape)', async () => {
    const members = makeMembers(8);
    const guard = new MembershipFreshnessGuard(makeReflector(false), members, cache, 30000);
    const ctx = makeContext({ user: USER, jwtIat: 1234, jwtMv: 5 });

    await guard.canActivate(ctx).catch((err: UnauthorizedException) => {
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.getResponse()).toEqual(STALE_MEMBERSHIPS_BODY);
      expect(STALE_MEMBERSHIPS_BODY.code).toBe('STALE_MEMBERSHIPS');
    });
  });

  it('amortizes the DB hit within the TTL window — N requests = 1 SELECT (cacheHit)', async () => {
    const members = makeMembers(5);
    const guard = new MembershipFreshnessGuard(makeReflector(false), members, cache, 30000);
    const ctx = makeContext({ user: USER, jwtIat: 1234, jwtMv: 5 });

    await guard.canActivate(ctx);
    await guard.canActivate(ctx);
    await guard.canActivate(ctx);

    expect(members.getCurrentVersion).toHaveBeenCalledTimes(1);
    // Sanity: the cache key shape matches the documented `(userId, jwtIat)` contract.
    expect(cache.get(buildFreshnessKey('user-1', 1234))?.version).toBe(5);
  });

  it('different jwtIat values bypass the cache (cache key includes iat — re-mint forces re-query)', async () => {
    const members = makeMembers(5);
    const guard = new MembershipFreshnessGuard(makeReflector(false), members, cache, 30000);

    await guard.canActivate(makeContext({ user: USER, jwtIat: 1000, jwtMv: 5 }));
    await guard.canActivate(makeContext({ user: USER, jwtIat: 2000, jwtMv: 5 }));

    expect(members.getCurrentVersion).toHaveBeenCalledTimes(2);
  });

  it('post-TTL expiry forces a fresh DB read (cacheExpiry)', async () => {
    const members = makeMembers(5);
    const ttl = 30000;
    const guard = new MembershipFreshnessGuard(makeReflector(false), members, cache, ttl);
    const ctx = makeContext({ user: USER, jwtIat: 1234, jwtMv: 5 });

    const t0 = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(t0);

    await guard.canActivate(ctx);
    expect(members.getCurrentVersion).toHaveBeenCalledTimes(1);

    // Advance past the TTL — entry should be evicted on next read.
    nowSpy.mockReturnValue(t0 + ttl + 1);
    await guard.canActivate(ctx);
    expect(members.getCurrentVersion).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });
});

describe('InMemoryFreshnessCache', () => {
  it('evicts expired entries on read (opportunistic eviction)', () => {
    const cache = new InMemoryFreshnessCache();
    const t0 = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(t0);

    cache.set('k', 5, 1000);
    expect(cache.get('k')?.version).toBe(5);
    expect(cache.size()).toBe(1);

    nowSpy.mockReturnValue(t0 + 1001);
    expect(cache.get('k')).toBeUndefined();
    expect(cache.size()).toBe(0); // evicted as side effect of get()

    nowSpy.mockRestore();
  });

  it('clear() drops every entry', () => {
    const cache = new InMemoryFreshnessCache();
    cache.set('a', 1, 30000);
    cache.set('b', 2, 30000);
    expect(cache.size()).toBe(2);
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});

describe('buildFreshnessKey', () => {
  it('joins userId and jwtIat with a colon', () => {
    expect(buildFreshnessKey('user-1', 1234)).toBe('user-1:1234');
  });
});
