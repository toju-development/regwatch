// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { readEdgeSession, __test__ } from '../edge-jwt.js';

/**
 * Spec: `sdd/auth-authorization-guards/spec` § "Web Edge Middleware Gates
 * Protected Routes" — edge JWT verification fallback path.
 * Design §2 (Plan B): direct HS256 verify on the cookie.
 *
 * These tests cover task 7.2 explicitly: the cookie-name fallback must be
 * derived ONLY from `process.env.NODE_ENV` (NOT from t3-env), so a build
 * with `SKIP_ENV_VALIDATION=1` still picks the correct cookie name.
 */

const SECRET = 'edge-jwt-test-secret-must-be-at-least-32-chars';

interface FakeCookies {
  store: Map<string, string>;
  get(name: string): { value: string } | undefined;
}

function makeReq(cookies: Record<string, string> = {}): { cookies: FakeCookies } {
  const store = new Map<string, string>(Object.entries(cookies));
  return {
    cookies: {
      store,
      get(name: string) {
        const v = store.get(name);
        return v === undefined ? undefined : { value: v };
      },
    },
  };
}

async function signToken(payload: Record<string, unknown>, secret = SECRET): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.stubEnv('AUTH_SECRET', SECRET);
  // Default to non-production so cookie name is `authjs.session-token`.
  vi.stubEnv('NODE_ENV', 'test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// Sanity guard: ensure we don't accidentally pollute env across the suite.
afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
});

describe('readEdgeSession', () => {
  it('returns payload for a valid HS256 token in the dev cookie', async () => {
    const tok = await signToken({ sub: 'user_1', email: 'a@b.test' });
    const req = makeReq({ 'authjs.session-token': tok });
    const payload = await readEdgeSession(req);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('user_1');
    expect(payload?.email).toBe('a@b.test');
  });

  it('returns null when the cookie is absent', async () => {
    const req = makeReq();
    const payload = await readEdgeSession(req);
    expect(payload).toBeNull();
  });

  it('returns null when the signature is invalid (wrong secret)', async () => {
    const tok = await signToken({ sub: 'user_1' }, 'a-completely-different-32-char-secret!!');
    const req = makeReq({ 'authjs.session-token': tok });
    const payload = await readEdgeSession(req);
    expect(payload).toBeNull();
  });

  it('returns null when the cookie value is malformed', async () => {
    const req = makeReq({ 'authjs.session-token': 'not.a.valid.jwt' });
    const payload = await readEdgeSession(req);
    expect(payload).toBeNull();
  });

  it('returns null when AUTH_SECRET is missing (defensive on misconfig)', async () => {
    const tok = await signToken({ sub: 'user_1' });
    vi.stubEnv('AUTH_SECRET', '');
    const req = makeReq({ 'authjs.session-token': tok });
    const payload = await readEdgeSession(req);
    expect(payload).toBeNull();
  });
});

describe('cookie-name fallback (task 7.2)', () => {
  it('uses the unprefixed name when NODE_ENV !== "production"', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(__test__.getSessionCookieName()).toBe('authjs.session-token');
    vi.stubEnv('NODE_ENV', 'test');
    expect(__test__.getSessionCookieName()).toBe('authjs.session-token');
  });

  it('uses the __Secure- prefixed name in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(__test__.getSessionCookieName()).toBe('__Secure-authjs.session-token');
  });

  it('reads only NODE_ENV (does NOT depend on t3-env / SKIP_ENV_VALIDATION)', async () => {
    // Simulate a build-with-validation-skipped scenario: t3-env wouldn't
    // populate any of its derived flags. We only set NODE_ENV — the cookie
    // name must still resolve correctly.
    vi.stubEnv('SKIP_ENV_VALIDATION', '1');
    vi.stubEnv('NODE_ENV', 'production');
    expect(__test__.getSessionCookieName()).toBe('__Secure-authjs.session-token');

    // And the prod cookie is what readEdgeSession looks for:
    const tok = await signToken({ sub: 'user_1' });
    const req = makeReq({ '__Secure-authjs.session-token': tok });
    const payload = await readEdgeSession(req);
    expect(payload?.sub).toBe('user_1');
  });
});
