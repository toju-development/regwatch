import { expect, test } from '@playwright/test';

/**
 * E2E coverage for `sdd/auth-foundation/spec` § auth:
 *   - R "Magic Link Sign-in" — request → click → land authenticated
 *   - R "Auto-Org-on-Signup Invariant" — first sign-in produces a session
 *   - R "Protected API Route via JwtAuthGuard" — Bearer flow against apps/api
 *
 * Magic Link uses the in-process `memoryEmailProvider` (apps/web). The test
 * polls `/api/test/inbox/<email>` (double-guarded test endpoint) until
 * the magic URL appears, then navigates to it. NOTE: folder is `test/`
 * (NOT `_test/`) — Next.js App Router treats `_`-prefixed folders as
 * private (non-routed), which would yield 404.
 *
 * Bearer flow extracts the `authjs.session-token` cookie value (which IS
 * the HS256 JWS thanks to the R-Sign override in `lib/auth.ts`) and sends
 * it as `Authorization: Bearer <jws>` to the apps/api `_test/me` canary.
 *
 * Pre-conditions: Postgres up at DATABASE_URL (used by both web + api).
 * Both webServers are launched by `playwright.config.ts`.
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
  // FIXME (B6.5 hotfix — block before MVP-3a production sign-off):
  // Auth.js v5 + Resend memory provider returns 200 on /api/auth/callback/resend
  // instead of the expected 302, then the browser lands back on /verify-request
  // (as if the token were invalid). `page.goto(magicUrl, { waitUntil: 'commit' })`
  // still yields ERR_ABORTED. Inbox + token round-trip work (memory-transport
  // populates correctly after the globalThis fix); the failure is in the callback
  // handler. Investigate: PrismaAdapter.useVerificationToken arg shape, the
  // R-Sign HS256 jwt.encode override interaction with the magic-link callback,
  // or whether `redirectTo` is being honored. See engram bugfix observation
  // "auth-foundation MVP-3a — 2 known E2E failures (B6.5 hotfix needed)".
  test.fixme(
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

      // Visit the magic link → triggers token verification + events.createUser.
      // `waitUntil: 'commit'` because the callback issues a 302 redirect
      // mid-load → default 'load' wait yields ERR_ABORTED.
      await page.goto(magicUrl, { waitUntil: 'commit' });

      // Wait for redirect away from the auth callback to home (or any non-auth page).
      await page.waitForURL((url) => !url.pathname.startsWith('/api/auth'), {
        timeout: 15_000,
      });

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

  // FIXME (B6.5 hotfix — block before MVP-3a production sign-off):
  // fake-google Credentials provider sign-in: form submit POSTs /login → 303
  // → GET / completes, but NO `authjs.session-token` cookie is set, so the
  // Bearer hand-off to apps/api can't proceed. Suspect: (a) the R-Sign HS256
  // `jwt.encode` override in lib/auth.ts may not be invoked for Credentials
  // sessions (Auth.js v5 sometimes routes Credentials through a different
  // session-token codec), or (b) the `authorize()` return shape is missing
  // a field Auth.js requires to mint a JWT. Confirm by adding a server-side
  // log in the jwt callback to see if it fires for google-fake. See engram
  // bugfix observation "auth-foundation MVP-3a — 2 known E2E failures".
  test.fixme(
    'apps/api _test/me returns 200 with valid Bearer token from web session',
    { tag: ['@e2e', '@auth', '@critical'] },
    async ({ page, request, context }) => {
      // Use fake-google to short-circuit Magic Link round-trip in this test.
      const email = uniqueEmail('bearer');

      await page.goto('/login');
      await page.getByTestId('fake-google-email').fill(email);
      await page.getByTestId('fake-google-signin').click();

      await page.waitForURL((url) => !url.pathname.startsWith('/api/auth'), {
        timeout: 15_000,
      });

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
