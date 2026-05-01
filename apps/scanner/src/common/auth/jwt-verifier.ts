// MVP-5: copy-pasted VERBATIM from apps/api/src/common/auth/jwt-verifier.ts.
// Extract to packages/auth-guards in MVP-13 when 4 new scanner apps need
// to reuse. MembershipFreshnessGuard intentionally NOT copied — see B5
// apply-progress for reasoning.
import { Injectable } from '@nestjs/common';
import { errors as joseErrors, jwtVerify } from 'jose';
import { z } from 'zod';
import type { JwtClaims, MembershipClaim, Role } from '@regwatch/types';
import { MEMBERSHIPS_CLAIM_CAP } from '@regwatch/types';
import { env } from '../../env.js';

/**
 * Thrown by {@link JwtVerifier.verify} for ANY verification failure
 * (expired, bad signature, malformed, payload-shape mismatch, iss/aud
 * mismatch). Single error class keeps the guard's 401 path uniform.
 */
export class JwtVerificationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'JwtVerificationError';
  }
}

const roleSchema: z.ZodType<Role> = z.enum(['OWNER', 'ADMIN', 'ANALYST', 'VIEWER']);

const membershipSchema: z.ZodType<MembershipClaim> = z.object({
  organizationId: z.string().min(1),
  orgSlug: z.string().min(1),
  role: roleSchema,
});

const jwtClaimsSchema = z.object({
  sub: z.string().min(1),
  userId: z.string().min(1),
  email: z.email(),
  memberships: z.array(membershipSchema).max(MEMBERSHIPS_CLAIM_CAP),
  mv: z.number().int().nonnegative().optional(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  iss: z.string().min(1).optional(),
  aud: z.string().min(1).optional(),
});

/**
 * Verifies HS256 JWTs signed by `apps/web`. Mirrors the api-side verifier
 * exactly — shares the same `AUTH_SECRET` / `JWT_ISSUER` / `JWT_AUDIENCE`
 * env contract via `@regwatch/config` (`createApiEnv`).
 */
@Injectable()
export class JwtVerifier {
  private readonly secret: Uint8Array;
  private readonly issuer: string | undefined;
  private readonly audience: string | undefined;

  constructor() {
    this.secret = new TextEncoder().encode(env.AUTH_SECRET);
    this.issuer = env.JWT_ISSUER;
    this.audience = env.JWT_AUDIENCE;
  }

  async verify(token: string): Promise<JwtClaims> {
    let payload: unknown;
    try {
      const result = await jwtVerify(token, this.secret, {
        algorithms: ['HS256'],
        ...(this.issuer ? { issuer: this.issuer } : {}),
        ...(this.audience ? { audience: this.audience } : {}),
      });
      payload = result.payload;
    } catch (err) {
      if (err instanceof joseErrors.JOSEError) {
        throw new JwtVerificationError(`jose: ${err.code ?? err.name}`, { cause: err });
      }
      throw new JwtVerificationError('jwt verification failed', { cause: err });
    }

    const parsed = jwtClaimsSchema.safeParse(payload);
    if (!parsed.success) {
      throw new JwtVerificationError('jwt payload shape mismatch', { cause: parsed.error });
    }
    const { iss, aud, mv, ...rest } = parsed.data;
    const claims: JwtClaims = {
      ...rest,
      ...(iss !== undefined ? { iss } : {}),
      ...(aud !== undefined ? { aud } : {}),
      ...(mv !== undefined ? { mv } : {}),
    };
    return claims;
  }
}
