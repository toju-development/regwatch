import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { JwtVerificationError, JwtVerifier } from '../jwt-verifier.js';

/**
 * Spec: `sdd/auth-foundation/spec` capability `auth` —
 *   R "JWT Issuance Shape" (round-trip happy path)
 *   R "Protected API Route via JwtAuthGuard" S "Invalid / expired / bad-signature"
 *
 * The verifier reads `AUTH_SECRET` (and optional `JWT_ISSUER`/`JWT_AUDIENCE`)
 * from `env.ts` at constructor time. The test env is bootstrapped in
 * `apps/api/vitest.setup.ts` with `AUTH_SECRET=test-auth-secret-must-be-at-least-32-chars-ok`.
 */

const SECRET = 'test-auth-secret-must-be-at-least-32-chars-ok';
const SECRET_BYTES = new TextEncoder().encode(SECRET);

interface SignArgs {
  payload?: Record<string, unknown>;
  expiresIn?: string;
  notBefore?: string;
  secret?: Uint8Array;
  issuer?: string;
  audience?: string;
}

async function signTestToken(args: SignArgs = {}): Promise<string> {
  const payload = args.payload ?? {
    sub: 'user-123',
    userId: 'user-123',
    email: 'alice@example.com',
    memberships: [{ organizationId: 'org-1', orgSlug: 'alice', role: 'OWNER' }],
  };
  const builder = new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(args.expiresIn ?? '1h');
  if (args.issuer) builder.setIssuer(args.issuer);
  if (args.audience) builder.setAudience(args.audience);
  return builder.sign(args.secret ?? SECRET_BYTES);
}

describe('JwtVerifier', () => {
  it('round-trips a well-formed HS256 token', async () => {
    const verifier = new JwtVerifier();
    const token = await signTestToken();

    const claims = await verifier.verify(token);

    expect(claims.userId).toBe('user-123');
    expect(claims.sub).toBe('user-123');
    expect(claims.email).toBe('alice@example.com');
    expect(claims.memberships).toEqual([
      { organizationId: 'org-1', orgSlug: 'alice', role: 'OWNER' },
    ]);
    expect(claims.iat).toBeGreaterThan(0);
    expect(claims.exp).toBeGreaterThan(claims.iat);
    // Optional iss/aud were not set → must be absent (exactOptionalPropertyTypes).
    expect('iss' in claims).toBe(false);
    expect('aud' in claims).toBe(false);
  });

  it('rejects a token signed with a different secret as JwtVerificationError', async () => {
    const verifier = new JwtVerifier();
    const wrongSecret = new TextEncoder().encode('WRONG-secret-must-be-at-least-32-chars-yes-yes');
    const token = await signTestToken({ secret: wrongSecret });

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(JwtVerificationError);
  });

  it('rejects an expired token', async () => {
    const verifier = new JwtVerifier();
    // jose accepts negative durations relative to "now" via setExpirationTime
    // string offsets like "-1s".
    const token = await signTestToken({ expiresIn: '-1s' });

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(JwtVerificationError);
  });

  it('rejects a malformed (garbage) token', async () => {
    const verifier = new JwtVerifier();
    await expect(verifier.verify('not-a-jwt')).rejects.toBeInstanceOf(JwtVerificationError);
  });

  it('rejects a token whose payload shape does not match JwtClaims', async () => {
    const verifier = new JwtVerifier();
    // Missing required `userId`, `memberships`, etc.
    const token = await signTestToken({
      payload: { sub: 'user-123', email: 'alice@example.com' },
    });

    const err = await verifier.verify(token).catch((e) => e);
    expect(err).toBeInstanceOf(JwtVerificationError);
    expect((err as Error).message).toMatch(/payload shape/i);
  });

  it('rejects a memberships claim with an invalid role', async () => {
    const verifier = new JwtVerifier();
    const token = await signTestToken({
      payload: {
        sub: 'user-1',
        userId: 'user-1',
        email: 'x@y.com',
        memberships: [{ organizationId: 'o', orgSlug: 'o', role: 'GOD_MODE' }],
      },
    });

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(JwtVerificationError);
  });
});
