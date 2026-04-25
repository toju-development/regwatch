import { expect, test } from '@playwright/test';

/**
 * E2E coverage for `sdd/auth-foundation/spec` § auth:
 *   - R "Magic Link Sign-in" — request → click → land authenticated
 *   - R "Auto-Org-on-Signup Invariant" — first sign-in produces a session
 *   - R "Protected API Route via JwtAuthGuard" — Bearer flow against apps/api
 *
 * Magic Link uses the in-process `memoryEmailProvider` (apps/web). The test
 * polls `/api/test/inbox/<email>` (double-guarded test endpoint) until
 * the magic URL appears, then opens it via the shared `context.request`
 * (NOT `page.goto`) — see foot-gun note below.
 *
 * Bearer flow extracts the `authjs.session-token` cookie value (which IS
 * the HS256 JWS thanks to the R-Sign override in `lib/auth.ts`) and sends
 * it as `Authorization: Bearer <jws>` to the apps/api `_test/me` canary.
 *
 * Pre-conditions: Postgres up at DATABASE_URL (used by both web + api).
 * Both webServers are launched by `playwright.config.ts`.
 *
 * --- B6.5 foot-guns (kept here so future debuggers don't re-investigate) ---
 *
 * 1. `page.goto(magicUrl, { waitUntil: 'commit' })` yields `net::ERR_ABORTED`
 *    even though the callback returns a clean 302 + sets `authjs.session-token`.
 *    Chromium aborts the navigation when the response is a same-origin redirect
 *    issued mid-load with no body. Workaround: drive the callback through
 *    `context.request.get(magicUrl)` — it follows the redirect server-side and
 *    shares the cookie jar with `context`, so subsequent `page.goto('/')` sees
 *    the session cookie. Auth flow itself is correct; this is purely the test.
 *
 * 2. After clicking a Server Action button that calls `signIn()` for the
 *    Credentials provider, do NOT use `waitForURL((u) => !u.pathname.startsWith('/api/auth'))`
 *    when the starting URL is `/login` — that predicate is true IMMEDIATELY,
 *    so the test races past the action and grabs cookies before the response
 *    arrives. Use a positive predicate (e.g. exact `/`) or `waitForResponse`
 *    on the POST /login response and then `waitForLoadState('load')`.
 */

const API_BASE = 'http://localhost:3001';
const SESSION_COOKIE_NAMES = ['authjs.session-token', '__Secure-authjs.session-token'];

function uniqueEmail(tag: string): string {
  // Unique per run so adapter inserts a fresh User and triggers events.createUser.
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `${tag}-${stamp}@regwatch.local`;
}

interface InboxResponse {
  email: string;
  count: number;
  latest: { url: string; receivedAt: string } | null;
}

async function waitForMagicLink(
  request: import('@playwright/test').APIRequestContext,
  email: string,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastBody: InboxResponse | null = null;
  while (Date.now() < deadline) {
    const res = await request.get(`/api/test/inbox/${encodeURIComponent(email)}`);
    if (res.ok()) {
      const body = (await res.json()) as InboxResponse;
      lastBody = body;
      if (body.latest?.url) return body.latest.url;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(
    `Magic link not received for ${email} within ${timeoutMs}ms; last inbox=${JSON.stringify(lastBody)}`,
  );
}

test.describe('Magic Link sign-in', () => {
  test(
    'request → click → authenticated session cookie present',
    { tag: ['@e2e', '@auth', '@critical'] },
    async ({ page, request, context }) => {
      const email = uniqueEmail('magic');

      await page.goto('/login');
      await page.getByTestId('magic-link-email').fill(email);
      await page.getByTestId('magic-link-submit').click();

      // NextAuth's verify-request page is the post-submit destination.
      await page.waitForURL(/\/api\/auth\/verify-request|\/login/);

      const magicUrl = await waitForMagicLink(request, email);

      // Foot-gun #1 (see file header): drive the callback via the shared
      // request context, NOT page.goto — Chromium aborts on the 302.
      // `context.request` shares its cookie jar with `context.cookies()`,
      // so the session cookie set by the 302 IS picked up by the browser
      // context for subsequent page.goto calls.
      const callbackRes = await context.request.get(magicUrl, { maxRedirects: 0 });
      expect(
        callbackRes.status(),
        'callback must 302 to home (HTML body indicates verify-request fallback)',
      ).toBe(302);
      expect(callbackRes.headers()['location']).toContain('/');

      // Now navigate the actual browser page — cookie is in the jar.
      await page.goto('/');

      const cookies = await context.cookies();
      const session = cookies.find((c) => SESSION_COOKIE_NAMES.includes(c.name));
      expect(
        session,
        `expected one of ${SESSION_COOKIE_NAMES.join(' / ')} cookies after Magic Link sign-in`,
      ).toBeDefined();
      expect(session!.value.length).toBeGreaterThan(20);
      // Auth.js cookie defaults — security flags MUST be present.
      expect(session!.httpOnly).toBe(true);
    },
  );
});

test.describe('protected api route', () => {
  test(
    'apps/api _test/me returns 401 without Bearer token',
    { tag: ['@e2e', '@auth'] },
    async ({ request }) => {
      const res = await request.get(`${API_BASE}/_test/me`);
      expect(res.status()).toBe(401);
    },
  );

  test(
    'apps/api _test/me returns 200 with valid Bearer token from web session',
    { tag: ['@e2e', '@auth', '@critical'] },
    async ({ page, request, context }) => {
      // Use fake-google to short-circuit Magic Link round-trip in this test.
      const email = uniqueEmail('bearer');

      await page.goto('/login');
      await page.getByTestId('fake-google-email').fill(email);

      // Foot-gun #2 (see file header): wait for the Server Action's POST
      // response BEFORE checking cookies. Using a "not on /api/auth" URL
      // predicate would resolve instantly (we're on /login), racing past
      // the action.
      const [actionResp] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/login') && r.request().method() === 'POST'),
        page.getByTestId('fake-google-signin').click(),
      ]);
      // Server Action redirect responses are 303; the response itself sets
      // the Set-Cookie header that lands `authjs.session-token` in the jar.
      expect([200, 303]).toContain(actionResp.status());
      // Wait for the browser to follow the redirect and finish loading the
      // destination page so the cookie jar is fully populated.
      await page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 });
      await page.waitForLoadState('load');

      const cookies = await context.cookies();
      const session = cookies.find((c) => SESSION_COOKIE_NAMES.includes(c.name));
      expect(session, 'fake-google sign-in must produce a session cookie').toBeDefined();

      // R-Sign: the cookie value IS a verifiable HS256 JWS — apps/api's
      // JwtVerifier uses the same AUTH_SECRET → must accept it.
      const res = await request.get(`${API_BASE}/_test/me`, {
        headers: { Authorization: `Bearer ${session!.value}` },
      });
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { user: { email: string; userId: string } };
      expect(body.user?.email).toBe(email);
      expect(body.user?.userId).toBeTruthy();
    },
  );
});
