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
 *
 * Spec: `sdd/auth-foundation/spec` capability `auth` —
 * R "Protected API Route via JwtAuthGuard" S "Invalid / expired / bad-signature".
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

/**
 * Runtime-narrowing schema for the canonical JWT payload.
 *
 * Mirrors {@link JwtClaims} from `@regwatch/types`. Tolerates the optional
 * `iss`/`aud` claims (jose already validates them when configured). The
 * shape MUST stay in sync with the issuer in `apps/web/src/lib/auth.ts`.
 */
const jwtClaimsSchema = z.object({
  sub: z.string().min(1),
  userId: z.string().min(1),
  email: z.email(),
  memberships: z.array(membershipSchema).max(MEMBERSHIPS_CLAIM_CAP),
  // R-Jwt-Invalidate-Cross-User (sdd/org-members) — `User.membershipsVersion`
  // at mint time. Optional here for transition compat with pre-3b3a JWTs;
  // `MembershipFreshnessGuard` treats absent `mv` as STALE.
  mv: z.number().int().nonnegative().optional(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  iss: z.string().min(1).optional(),
  aud: z.string().min(1).optional(),
});

/**
 * Verifies HS256 JWTs signed by `apps/web` (NextAuth `jwt.encode` override
 * → JWS HS256). Single source of truth for shared-secret JWT validation
 * inside `apps/api`.
 *
 * Design: `sdd/auth-foundation/design` §3 + Q9 — `jose.jwtVerify` with
 * cached `Uint8Array` secret; honors `JWT_ISSUER`/`JWT_AUDIENCE` when set.
 */
@Injectable()
export class JwtVerifier {
  private readonly secret: Uint8Array;
  private readonly issuer: string | undefined;
  private readonly audience: string | undefined;

  constructor() {
    // Cached once at DI bootstrap — `TextEncoder` allocation per-request is
    // wasteful at request volume.
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
    // Strip `undefined` optional fields so the return type satisfies
    // `exactOptionalPropertyTypes: true` against `JwtClaims`.
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
