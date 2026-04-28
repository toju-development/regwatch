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
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { JwtVerificationError, JwtVerifier } from './jwt-verifier.js';

const BEARER_PREFIX = /^Bearer\s+/i;

/**
 * Globally-registered guard (via `APP_GUARD` in `AuthModule`). Default
 * stance: every route is protected. Opt out with `@Public()`.
 *
 * Spec: `sdd/auth-foundation/spec` R "Protected API Route via JwtAuthGuard".
 * Design: §1 + Q9 — `jose` HS256, no Passport.
 *
 * Constructor uses explicit `@Inject()` tokens because the runtime is `tsx`
 * (esbuild) which does NOT emit `design:paramtypes` metadata. Without
 * explicit tokens, Nest's DI cannot resolve `Reflector` / `JwtVerifier`.
 * Carry-forward from MVP-1 tsx runtime decision.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtVerifier) private readonly verifier: JwtVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
    const header = this.extractAuthorizationHeader(request);
    if (!header) {
      throw new UnauthorizedException('Missing Authorization header');
    }
    if (!BEARER_PREFIX.test(header)) {
      throw new UnauthorizedException('Authorization header must use Bearer scheme');
    }
    const token = header.replace(BEARER_PREFIX, '').trim();
    if (!token) {
      throw new UnauthorizedException('Empty bearer token');
    }

    try {
      const claims = await this.verifier.verify(token);
      const authUser: AuthUser = {
        userId: claims.userId,
        email: claims.email,
        memberships: claims.memberships,
        ...(claims.mv !== undefined ? { mv: claims.mv } : {}),
      };
      request.user = authUser;
      // Surface `iat` and `mv` on the request itself so
      // `MembershipFreshnessGuard` (B2, sdd/org-members) can key its
      // 30s in-process cache on `(userId, jwtIat)` and compare `jwtMv`
      // against the live `User.membershipsVersion` without re-decoding.
      request.jwtIat = claims.iat;
      if (claims.mv !== undefined) request.jwtMv = claims.mv;
      return true;
    } catch (err) {
      if (err instanceof JwtVerificationError) {
        throw new UnauthorizedException('Invalid or expired token');
      }
      throw err;
    }
  }

  private extractAuthorizationHeader(request: Request): string | undefined {
    // Express normalizes header names to lower-case. Accept the raw value if
    // a downstream framework hands us a case-preserving headers bag.
    const raw =
      request.headers['authorization'] ?? request.headers['Authorization' as 'authorization'];
    if (Array.isArray(raw)) return raw[0];
    return raw ?? undefined;
  }
}
