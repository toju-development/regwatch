// MVP-5: copy-pasted from apps/api/src/common/auth/jwt-auth.guard.ts.
// Extract to packages/auth-guards in MVP-13. MembershipFreshnessGuard NOT
// copied — `request.jwtIat` / `request.jwtMv` are still attached for
// forward-compat but currently consumed by no scanner-side guard.
// See B5 apply-progress for reasoning.
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
 * Per-route guard (NOT a global APP_GUARD in `apps/scanner` — only
 * `/scan/trigger` is protected; `/health` is public). Apply via
 * `@UseGuards(JwtAuthGuard, RolesGuard)`.
 *
 * tsx + NestJS DI requires explicit `@Inject()` tokens (foot-gun #667).
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
    const raw =
      request.headers['authorization'] ?? request.headers['Authorization' as 'authorization'];
    if (Array.isArray(raw)) return raw[0];
    return raw ?? undefined;
  }
}
