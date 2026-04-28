import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser, JwtClaims } from '@regwatch/types';
import { JwtAuthGuard } from '../jwt-auth.guard.js';
import { JwtVerificationError, JwtVerifier } from '../jwt-verifier.js';

/**
 * 5-case matrix per spec `sdd/auth-foundation/spec` capability `auth` —
 *   R "Protected API Route via JwtAuthGuard":
 *   1. No Authorization header → 401
 *   2. Non-Bearer scheme        → 401
 *   3. Invalid token (verifier throws) → 401
 *   4. Valid token              → true + request.user populated
 *   5. @Public() route          → true (verifier never invoked)
 *
 * Plus: empty Bearer token → 401 (defensive).
 */

interface FakeReq {
  headers: Record<string, string | string[] | undefined>;
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

function makeVerifier(impl: (token: string) => Promise<JwtClaims>): JwtVerifier {
  return { verify: vi.fn(impl) } as unknown as JwtVerifier;
}

const VALID_CLAIMS: JwtClaims = {
  sub: 'user-1',
  userId: 'user-1',
  email: 'a@b.com',
  memberships: [{ organizationId: 'o', orgSlug: 'o', role: 'OWNER' }],
  iat: 1,
  exp: 9999999999,
};

describe('JwtAuthGuard', () => {
  it('throws 401 when Authorization header is missing', async () => {
    const guard = new JwtAuthGuard(
      makeReflector(false),
      makeVerifier(async () => VALID_CLAIMS),
    );
    const ctx = makeContext({ headers: {} });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws 401 when Authorization header uses a non-Bearer scheme', async () => {
    const guard = new JwtAuthGuard(
      makeReflector(false),
      makeVerifier(async () => VALID_CLAIMS),
    );
    const ctx = makeContext({ headers: { authorization: 'Basic dXNlcjpwYXNz' } });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws 401 when the Bearer token is empty', async () => {
    const guard = new JwtAuthGuard(
      makeReflector(false),
      makeVerifier(async () => VALID_CLAIMS),
    );
    const ctx = makeContext({ headers: { authorization: 'Bearer   ' } });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws 401 when the verifier throws JwtVerificationError', async () => {
    const guard = new JwtAuthGuard(
      makeReflector(false),
      makeVerifier(async () => {
        throw new JwtVerificationError('bad sig');
      }),
    );
    const ctx = makeContext({ headers: { authorization: 'Bearer abc.def.ghi' } });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns true and attaches request.user for a valid token', async () => {
    const verifier = makeVerifier(async () => VALID_CLAIMS);
    const guard = new JwtAuthGuard(makeReflector(false), verifier);
    const req: FakeReq = { headers: { authorization: 'Bearer good.token.here' } };
    const ctx = makeContext(req);

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(req.user).toEqual({
      userId: 'user-1',
      email: 'a@b.com',
      memberships: [{ organizationId: 'o', orgSlug: 'o', role: 'OWNER' }],
    });
    expect(verifier.verify).toHaveBeenCalledWith('good.token.here');
  });

  it('bypasses verification entirely when @Public() metadata is present', async () => {
    const verifier = makeVerifier(async () => VALID_CLAIMS);
    const guard = new JwtAuthGuard(makeReflector(true), verifier);
    const ctx = makeContext({ headers: {} });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('re-throws non-JwtVerificationError errors from the verifier as-is', async () => {
    const boom = new Error('upstream blew up');
    const guard = new JwtAuthGuard(
      makeReflector(false),
      makeVerifier(async () => {
        throw boom;
      }),
    );
    const ctx = makeContext({ headers: { authorization: 'Bearer x.y.z' } });

    await expect(guard.canActivate(ctx)).rejects.toBe(boom);
  });

  // ---------------------------------------------------------------------
  // sdd/org-members B1 — R-Jwt-Invalidate-Cross-User
  // The guard MUST surface the verified `mv` and `iat` claims onto the
  // request so `MembershipFreshnessGuard` (B2) can run its check without
  // re-decoding the token.
  // ---------------------------------------------------------------------

  it('attaches request.jwtIat, request.jwtMv and user.mv when claims include `mv`', async () => {
    const claims: JwtClaims = { ...VALID_CLAIMS, mv: 7, iat: 1234 };
    const guard = new JwtAuthGuard(
      makeReflector(false),
      makeVerifier(async () => claims),
    );
    const req: FakeReq = { headers: { authorization: 'Bearer ok.token' } };
    const ctx = makeContext(req);

    await guard.canActivate(ctx);

    expect(req.user?.mv).toBe(7);
    expect(req.jwtMv).toBe(7);
    expect(req.jwtIat).toBe(1234);
  });

  it('omits jwtMv and user.mv when claims lack `mv` (pre-3b3a token)', async () => {
    const guard = new JwtAuthGuard(
      makeReflector(false),
      makeVerifier(async () => VALID_CLAIMS),
    );
    const req: FakeReq = { headers: { authorization: 'Bearer ok.token' } };
    const ctx = makeContext(req);

    await guard.canActivate(ctx);

    // `mv` absent — `MembershipFreshnessGuard` (B2) will treat as STALE.
    expect(req.user?.mv).toBeUndefined();
    expect(req.jwtMv).toBeUndefined();
    // `iat` is always present in a valid JWT.
    expect(req.jwtIat).toBe(VALID_CLAIMS.iat);
  });
});
