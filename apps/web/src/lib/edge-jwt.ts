/**
 * Edge-runtime HS256 session decoder (Plan B per design §2).
 *
 * Spec: `sdd/auth-authorization-guards/spec` § "Web Edge Middleware Gates
 * Protected Routes". Design §2 (Plan B chosen): direct `jose.jwtVerify` on
 * the session cookie — owns the format end-to-end and is immune to Auth.js
 * v5's default JWE A256CBC-HS512 decode (foot-gun #5).
 *
 * Edge constraints respected:
 *   - imports `jose` only (edge-compatible, uses Web Crypto)
 *   - NO Prisma, NO `auth.ts`, NO `node:crypto`
 *   - reads `process.env.AUTH_SECRET` and `process.env.NODE_ENV` directly
 *     (Next.js exposes server-only env to middleware)
 *
 * Cookie name fallback (task 7.2): derived solely from `process.env.NODE_ENV`
 * so that a `SKIP_ENV_VALIDATION=1` build (which strips t3-env defaults) still
 * picks the correct name. Matches Auth.js v5 cookie naming convention.
 */
import { jwtVerify, type JWTPayload } from 'jose';

/**
 * Auth.js v5 session cookie name. The `__Secure-` prefix is enforced by
 * Auth.js in production (HTTPS-only); dev uses the unprefixed name.
 *
 * IMPORTANT: do NOT read this from `env` (t3-env). On builds with
 * `SKIP_ENV_VALIDATION=1` the schema defaults are NOT applied and any value
 * we pull through `env.*` is undefined, breaking middleware silently.
 */
function getSessionCookieName(): string {
  return process.env.NODE_ENV === 'production'
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';
}

/** Minimal duck-typed cookie reader satisfied by Next's `NextRequest`. */
interface CookieReader {
  get(name: string): { value: string } | undefined;
}
interface RequestWithCookies {
  cookies: CookieReader;
}

/**
 * Verify the HS256 session JWS in the Auth.js cookie and return its payload.
 * Returns `null` on any failure (missing cookie, bad signature, expired,
 * malformed, missing secret) — middleware treats `null` as "unauthenticated".
 *
 * Algorithm restricted to HS256 to mirror the encode override in
 * `apps/web/src/lib/auth.ts` (R-Sign). Signature alone is sufficient: we
 * don't enforce iss/aud here because the cookie cannot exist on this domain
 * unless our own Auth.js handler minted it with our secret.
 */
export async function readEdgeSession(req: RequestWithCookies): Promise<JWTPayload | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;

  const cookieName = getSessionCookieName();
  const tok = req.cookies.get(cookieName)?.value;
  if (!tok) return null;

  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(tok, key, { algorithms: ['HS256'] });
    return payload;
  } catch {
    return null;
  }
}

/** Exported for unit tests only — DO NOT use in app code. */
export const __test__ = { getSessionCookieName };
