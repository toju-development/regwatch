import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@regwatch/types';
import { OrgScopeGuard } from '../org-scope.guard.js';
import { IS_PUBLIC_KEY } from '../public.decorator.js';
import { IS_PUBLIC_SCOPE_KEY } from '../decorators/public-scope.decorator.js';

/**
 * Spec: `sdd/auth-authorization-guards/spec` R "OrgScopeGuard Resolves
 * Active Organization". Scenarios covered:
 *  1. Missing X-Org-Id header → ForbiddenException
 *  2. X-Org-Id not in JWT memberships → ForbiddenException
 *  3. X-Org-Id matches a membership → true + request.membership populated
 *  4. @PublicScope skips org check → true (no membership attached)
 *  5. @Public takes precedence → true (no membership attached)
 *
 * Plus defensive scenarios:
 *  6. Missing request.user (JwtAuthGuard skipped) → UnauthorizedException
 *  7. Header lookup is case-insensitive (Express lower-cases incoming
 *     header names; we still accept a `X-Org-Id`-keyed bag defensively).
 */

interface FakeReq {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
  membership?: {
    organizationId: string;
    role: AuthUser['memberships'][number]['role'];
    orgSlug: string;
  };
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

/**
 * Reflector mock keyed by metadata key — `OrgScopeGuard` calls
 * `getAllAndOverride` for `IS_PUBLIC_KEY` first, then `IS_PUBLIC_SCOPE_KEY`.
 */
function makeReflector(opts: { isPublic?: boolean; isPublicScope?: boolean }): Reflector {
  return {
    getAllAndOverride: vi.fn((key: string) => {
      if (key === IS_PUBLIC_KEY) return opts.isPublic ?? false;
      if (key === IS_PUBLIC_SCOPE_KEY) return opts.isPublicScope ?? false;
      return undefined;
    }),
  } as unknown as Reflector;
}

const USER: AuthUser = {
  userId: 'user-1',
  email: 'a@b.com',
  memberships: [
    { organizationId: 'org_x', orgSlug: 'x', role: 'OWNER' },
    { organizationId: 'org_y', orgSlug: 'y', role: 'VIEWER' },
  ],
};

describe('OrgScopeGuard', () => {
  it('@Public() route short-circuits (returns true) even with no X-Org-Id and no user', () => {
    const guard = new OrgScopeGuard(makeReflector({ isPublic: true }));
    const req: FakeReq = { headers: {} };
    const ctx = makeContext(req);

    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.membership).toBeUndefined();
  });

  it('@PublicScope() route returns true with no X-Org-Id and does not set membership', () => {
    const guard = new OrgScopeGuard(makeReflector({ isPublicScope: true }));
    const req: FakeReq = { headers: {}, user: USER };
    const ctx = makeContext(req);

    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.membership).toBeUndefined();
  });

  it('throws ForbiddenException when X-Org-Id header is missing on a standard route', () => {
    const guard = new OrgScopeGuard(makeReflector({}));
    const req: FakeReq = { headers: {}, user: USER };
    const ctx = makeContext(req);

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(req.membership).toBeUndefined();
  });

  it('returns true and populates request.membership when X-Org-Id matches a JWT membership', () => {
    const guard = new OrgScopeGuard(makeReflector({}));
    const req: FakeReq = { headers: { 'x-org-id': 'org_x' }, user: USER };
    const ctx = makeContext(req);

    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.membership).toEqual({
      organizationId: 'org_x',
      role: 'OWNER',
      orgSlug: 'x',
    });
  });

  it('throws ForbiddenException when X-Org-Id is not in JWT memberships', () => {
    const guard = new OrgScopeGuard(makeReflector({}));
    const req: FakeReq = { headers: { 'x-org-id': 'org_other' }, user: USER };
    const ctx = makeContext(req);

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(req.membership).toBeUndefined();
  });

  it('throws UnauthorizedException when request.user is missing on a standard route (defensive)', () => {
    const guard = new OrgScopeGuard(makeReflector({}));
    const req: FakeReq = { headers: { 'x-org-id': 'org_x' } };
    const ctx = makeContext(req);

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    expect(req.membership).toBeUndefined();
  });

  it('accepts the header under either case (Express normalizes, but we tolerate raw)', () => {
    // Express-normalized lowercase form
    const guardA = new OrgScopeGuard(makeReflector({}));
    const reqA: FakeReq = { headers: { 'x-org-id': 'org_y' }, user: USER };
    expect(guardA.canActivate(makeContext(reqA))).toBe(true);
    expect(reqA.membership?.organizationId).toBe('org_y');

    // Defensive: case-preserving headers bag (some test harnesses)
    const guardB = new OrgScopeGuard(makeReflector({}));
    const reqB: FakeReq = { headers: { 'X-Org-Id': 'org_y' }, user: USER };
    expect(guardB.canActivate(makeContext(reqB))).toBe(true);
    expect(reqB.membership?.organizationId).toBe('org_y');
  });
});
