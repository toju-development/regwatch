// @vitest-environment node
/**
 * Spec: `sdd/org-membership-ux/spec` § R-ActiveOrgCookie scenario "Cookie is HttpOnly".
 * Design: §3 + decision #1.
 *
 * Asserts the dev/prod name matrix and the cookie attribute matrix
 * (HttpOnly, SameSite=Lax, Secure-in-prod, Path=/, session cookie).
 *
 * `@vitest-environment node` — required because `next/headers` ships
 * server-only code that throws under jsdom (analogous to the
 * `jose-jsdom-incompat` foot-gun from MVP-3a). We mock `next/headers`
 * for the cookie-store helpers; pure const/getter helpers can be
 * tested without any Next runtime.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getActiveOrgCookieName,
  getActiveOrgCookieOptions,
  getActiveOrgIdFromRequest,
} from '../active-org-cookie.js';
import type { NextRequest } from 'next/server';

describe('active-org-cookie name matrix', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the dev name when NODE_ENV !== "production"', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(getActiveOrgCookieName()).toBe('regwatch.active-org');
    vi.stubEnv('NODE_ENV', 'test');
    expect(getActiveOrgCookieName()).toBe('regwatch.active-org');
  });

  it('uses the __Secure- prefixed name in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(getActiveOrgCookieName()).toBe('__Secure-regwatch.active-org');
  });
});

describe('active-org-cookie options matrix', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('non-prod → HttpOnly + SameSite=Lax + secure=false + Path=/', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const opts = getActiveOrgCookieOptions();
    expect(opts).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
    });
  });

  it('prod → secure=true (matches the __Secure- prefix contract)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(getActiveOrgCookieOptions().secure).toBe(true);
  });

  it('never sets maxAge or expires (session cookie)', () => {
    const opts = getActiveOrgCookieOptions() as unknown as Record<string, unknown>;
    expect(opts.maxAge).toBeUndefined();
    expect(opts.expires).toBeUndefined();
  });
});

describe('getActiveOrgIdFromRequest', () => {
  function makeReq(cookieValue: string | null): NextRequest {
    const get = (name: string) =>
      cookieValue !== null && name === getActiveOrgCookieName()
        ? { name, value: cookieValue }
        : undefined;
    return { cookies: { get } } as unknown as NextRequest;
  }

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the cookie value when present', () => {
    expect(getActiveOrgIdFromRequest(makeReq('org-abc'))).toBe('org-abc');
  });

  it('returns null when the cookie is absent', () => {
    expect(getActiveOrgIdFromRequest(makeReq(null))).toBeNull();
  });
});

describe('getActiveOrgIdFromCookies (next/headers async API)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('next/headers');
  });

  it('reads the cookie from next/headers', async () => {
    vi.doMock('next/headers', () => ({
      cookies: async () => ({
        get: (name: string) =>
          name === 'regwatch.active-org' ? { name, value: 'org-from-headers' } : undefined,
      }),
    }));
    const { getActiveOrgIdFromCookies } = await import('../active-org-cookie.js');
    expect(await getActiveOrgIdFromCookies()).toBe('org-from-headers');
  });

  it('returns null when the cookie is missing', async () => {
    vi.doMock('next/headers', () => ({
      cookies: async () => ({ get: () => undefined }),
    }));
    const { getActiveOrgIdFromCookies } = await import('../active-org-cookie.js');
    expect(await getActiveOrgIdFromCookies()).toBeNull();
  });
});
