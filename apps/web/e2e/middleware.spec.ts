import { expect, test } from '@playwright/test';

/**
 * E2E coverage for `sdd/auth-authorization-guards/spec` § "Web Edge
 * Middleware Gates Protected Routes". Validates the matcher denylist,
 * the redirect to `/login?callbackUrl=...`, and the auth bypass.
 *
 * Auth-bypass test reuses the fake-google harness from `auth.spec.ts`
 * (the same pattern that produces an `authjs.session-token` HS256 JWS in
 * the browser context cookie jar).
 *
 * NOTE: routes like `/dashboard` need not exist as real pages — middleware
 * intercepts BEFORE the route handler resolves, so a missing app route
 * still triggers the redirect. We use `/dashboard` and `/settings` as
 * stable arbitrary protected paths.
 */

const SESSION_COOKIE_NAMES = ['authjs.session-token', '__Secure-authjs.session-token'];

function uniqueEmail(tag: string): string {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `${tag}-${stamp}@regwatch.local`;
}

test.describe('edge middleware', () => {
  test(
    'unauthenticated request to a protected route redirects to /login with callbackUrl',
    { tag: ['@e2e', '@auth', '@critical'] },
    async ({ request }) => {
      const res = await request.get('/dashboard', { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      const location = res.headers()['location'];
      expect(location).toBeTruthy();
      const url = new URL(location!, 'http://localhost:3000');
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('callbackUrl')).toBe('/dashboard');
    },
  );

  test(
    'callbackUrl preserves query string of the original request',
    { tag: ['@e2e', '@auth'] },
    async ({ request }) => {
      const res = await request.get('/settings?tab=billing', { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      const url = new URL(res.headers()['location']!, 'http://localhost:3000');
      expect(url.pathname).toBe('/login');
      // URLSearchParams.set percent-encodes the value automatically.
      expect(url.searchParams.get('callbackUrl')).toBe('/settings?tab=billing');
    },
  );

  test(
    '/login is excluded by the matcher (no redirect loop)',
    { tag: ['@e2e', '@auth'] },
    async ({ request }) => {
      const res = await request.get('/login', { maxRedirects: 0 });
      // /login renders directly — should be 200, never 3xx to itself.
      expect(res.status()).toBe(200);
    },
  );

  test(
    '/api/auth/* is excluded by the matcher (Auth.js handler runs unguarded)',
    { tag: ['@e2e', '@auth'] },
    async ({ request }) => {
      const res = await request.get('/api/auth/providers', { maxRedirects: 0 });
      // Auth.js providers endpoint should respond directly, never redirect to /login.
      const location = res.headers()['location'];
      if (location) {
        expect(new URL(location, 'http://localhost:3000').pathname).not.toBe('/login');
      }
      expect(res.status()).toBeLessThan(400);
    },
  );

  test(
    '/_next/static assets bypass middleware',
    { tag: ['@e2e', '@auth'] },
    async ({ request }) => {
      // Hit a likely-existing static path. Even if it 404s the response must
      // NOT be the middleware redirect to /login.
      const res = await request.get('/_next/static/chunks/main.js', { maxRedirects: 0 });
      const location = res.headers()['location'];
      if (location) {
        expect(new URL(location, 'http://localhost:3000').pathname).not.toBe('/login');
      }
      // Status should be either 200 (asset exists) or 404 (dev mode hash mismatch),
      // never the 307 the middleware would emit.
      expect([200, 304, 404]).toContain(res.status());
    },
  );

  test(
    'authenticated request passes through (no redirect)',
    { tag: ['@e2e', '@auth', '@critical'] },
    async ({ page, context }) => {
      // Sign in via fake-google (same pattern as auth.spec.ts).
      const email = uniqueEmail('mw-auth');

      await page.goto('/login');
      await page.getByTestId('fake-google-email').fill(email);
      const [actionResp] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/login') && r.request().method() === 'POST'),
        page.getByTestId('fake-google-signin').click(),
      ]);
      expect([200, 303]).toContain(actionResp.status());
      await page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 });
      await page.waitForLoadState('load');

      const cookies = await context.cookies();
      const session = cookies.find((c) => SESSION_COOKIE_NAMES.includes(c.name));
      expect(session, 'fake-google sign-in must produce a session cookie').toBeDefined();

      // Now visit a protected path; middleware must let us through.
      const res = await context.request.get('/dashboard', { maxRedirects: 0 });
      // No 307 redirect from the middleware. Either the route renders (200)
      // or returns a 404 (route doesn't exist) — both prove middleware passed.
      expect(res.status()).not.toBe(307);
      const location = res.headers()['location'];
      if (location) {
        expect(new URL(location, 'http://localhost:3000').pathname).not.toBe('/login');
      }
    },
  );
});
