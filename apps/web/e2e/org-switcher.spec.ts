import { expect, test, type Page, type BrowserContext } from '@playwright/test';

/**
 * E2E coverage for `sdd/org-membership-ux/spec` § R-Switcher full flow:
 *   - 1 membership → switcher renders disabled (no dropdown).
 *   - Programmatic `POST /api/org` provisions a second org out-of-band.
 *   - "Refresh session" → JWT picks up new membership claim.
 *   - Switcher activates → dropdown lists 2 orgs.
 *   - Selecting the 2nd org → `switchActiveOrg` cookie write → RSC re-runs.
 *   - `apiFetch('/api/org/me')` carries `X-Org-Id` matching the new active.
 *   - Sign-out clears `regwatch.active-org` (and `authjs.session-token`).
 *
 * Patterns reused from `auth.spec.ts` (kept so future debuggers don't
 * re-investigate):
 *
 * 1. Fake-google sign-in: wait for the Server Action POST /login response
 *    BEFORE checking cookies (negative URL predicates race past the action).
 *
 * 2. `context.request` shares its cookie jar with the browser context, so
 *    server-to-server hits to `/api/org` (the proxy) automatically carry
 *    the session cookie set by the sign-in flow. No manual header weaving.
 *
 * 3. `data-testid=org-switcher-trigger` carries `data-disabled="true"` in
 *    the 1-membership state — assert that attribute, NOT a CSS class
 *    (Tailwind classes are an implementation detail; data-* is the
 *    spec-stable selector).
 *
 * --- B6 foot-guns (saved to engram on first encounter) ---
 *
 * 4. `session.update()` → `router.refresh()` ordering matters: `update()`
 *    must RESOLVE before `refresh()`, otherwise the RSC re-runs against
 *    the stale JWT and the new membership won't appear. Handled inside
 *    `<DashboardClient>` via `await session.update?.()` then `refresh()`
 *    inside the same transition. The test just clicks the button and
 *    waits for the membership count to flip.
 *
 * 5. `waitForRequest` for `apiFetch` calls: the `apiFetch` wrapper hits
 *    LOCAL `/api/org/me` (PROXY MODE — see engram
 *    `regwatch/decisions/org-membership-proxy-mode`), so the predicate
 *    matches `/api/org/me` on `localhost:3000`, NOT the upstream API.
 *    Use `waitForRequest` (NOT `route` interception with continue) so
 *    Server Components stream their RSC payload uninterrupted.
 *
 * 6. Cookie name in dev: `regwatch.active-org` (the `__Secure-` prefix
 *    only applies in `NODE_ENV === 'production'`). Playwright config
 *    pins web to `NODE_ENV=development`, so the host-only name is
 *    correct here.
 */

const SESSION_COOKIE_NAMES = ['authjs.session-token', '__Secure-authjs.session-token'];
const ACTIVE_ORG_COOKIE_NAMES = ['regwatch.active-org', '__Secure-regwatch.active-org'];

function uniqueEmail(tag: string): string {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `${tag}-${stamp}@regwatch.local`;
}

async function fakeGoogleSignIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('fake-google-email').fill(email);
  // Foot-gun #1 carry-forward: positively wait for the action POST.
  const [actionResp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/login') && r.request().method() === 'POST'),
    page.getByTestId('fake-google-signin').click(),
  ]);
  expect([200, 303]).toContain(actionResp.status());
  await page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 });
  await page.waitForLoadState('load');
}

interface CreateOrgResponse {
  id: string;
  name: string;
  slug: string;
}

async function postOrgViaProxy(context: BrowserContext, name: string): Promise<CreateOrgResponse> {
  // `context.request` shares the cookie jar — the auth session cookie
  // attached during fakeGoogleSignIn is forwarded automatically to the
  // proxy handler, which mints `Authorization: Bearer <jwt>` server-side.
  const res = await context.request.post('/api/org', {
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({ name }),
  });
  expect(res.status(), `POST /api/org body=${await res.text()}`).toBe(201);
  return (await res.json()) as CreateOrgResponse;
}

test.describe('Org switcher full flow', () => {
  test(
    'single membership → create-via-API → switch → X-Org-Id propagates → sign-out clears cookie',
    { tag: ['@e2e', '@org-switcher', '@critical'] },
    async ({ page, context }) => {
      const email = uniqueEmail('switcher');

      // ── Phase 1: sign in (auto-org gives the user exactly 1 membership) ──
      await fakeGoogleSignIn(page, email);

      // ── Phase 2: land on /dashboard, layout RSC mounts switcher ──
      // The first apiFetch('/api/org/me') will fire on hydration. Capture
      // it so we can later assert the FIRST X-Org-Id value matches the
      // initial active org.
      const initialMeRequestPromise = page.waitForRequest(
        (req) => req.url().includes('/api/org/me') && req.method() === 'GET',
        { timeout: 15_000 },
      );
      await page.goto('/dashboard');
      await expect(page.getByTestId('dashboard-section')).toBeVisible();
      await expect(page.getByTestId('dashboard-hydrated')).toHaveText('yes');

      // 1-membership disabled state — spec R-Switcher S "Single membership".
      const trigger = page.getByTestId('org-switcher-trigger');
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveAttribute('data-disabled', 'true');
      await expect(trigger).toBeDisabled();
      await expect(page.getByTestId('dashboard-membership-count')).toHaveText('1');

      const initialActiveOrgId = await page.getByTestId('dashboard-active-org').textContent();
      expect(initialActiveOrgId, 'initial active org id must be present').toBeTruthy();

      // First /api/org/me carries the initial active org as X-Org-Id.
      const initialMeRequest = await initialMeRequestPromise;
      expect(initialMeRequest.headers()['x-org-id']).toBe(initialActiveOrgId);

      // ── Phase 3: provision a second org out-of-band via the proxy ──
      // This bypasses the (currently unreachable from disabled state)
      // dropdown create dialog — see foot-gun
      // `regwatch/footguns/org-switcher-1-membership-create-gap`.
      const created = await postOrgViaProxy(context, `Switcher Test ${Date.now()}`);
      expect(created.id).toBeTruthy();
      expect(created.id).not.toBe(initialActiveOrgId);

      // ── Phase 4: refresh session → JWT picks up new membership ──
      await page.getByTestId('dashboard-refresh-session').click();
      await expect(page.getByTestId('dashboard-membership-count')).toHaveText('2', {
        timeout: 10_000,
      });

      // Switcher is now enabled (2 memberships).
      await expect(trigger).not.toHaveAttribute('data-disabled', 'true');
      await expect(trigger).toBeEnabled();

      // ── Phase 5: open dropdown, pick the new org ──
      // Pre-arm the waitForRequest BEFORE the click so the post-switch
      // /api/org/me fetch is captured deterministically.
      const switchedMeRequestPromise = page.waitForRequest(
        (req) =>
          req.url().includes('/api/org/me') &&
          req.method() === 'GET' &&
          req.headers()['x-org-id'] === created.id,
        { timeout: 15_000 },
      );

      await trigger.click();
      const newOrgItem = page.getByTestId(`org-switcher-item-${created.id}`);
      await expect(newOrgItem).toBeVisible();
      await newOrgItem.click();

      // Wait for the RSC re-seed → useEffect re-fires apiFetch with new id.
      await switchedMeRequestPromise;
      await expect(page.getByTestId('dashboard-active-org')).toHaveText(created.id, {
        timeout: 10_000,
      });

      // ── Phase 6: sign out clears BOTH cookies ──
      const signoutNav = page.waitForURL(/\/login/, { timeout: 15_000 });
      await page.getByTestId('dashboard-signout').click();
      await signoutNav;

      const cookies = await context.cookies();
      const session = cookies.find((c) => SESSION_COOKIE_NAMES.includes(c.name));
      const activeOrg = cookies.find((c) => ACTIVE_ORG_COOKIE_NAMES.includes(c.name));
      // NextAuth sign-out and `clearActiveOrgOnSignOut` both clear via
      // `Set-Cookie: <name>=; Max-Age=0`. Playwright's cookie jar may
      // still surface the entry with `value: ""` (the browser hasn't
      // garbage-collected the empty record yet) — both "absent" and
      // "present-but-empty" are valid representations of "cleared".
      expect(
        session === undefined || session.value === '',
        `session cookie must be cleared after sign-out (got: ${JSON.stringify(session)})`,
      ).toBe(true);
      expect(
        activeOrg === undefined || activeOrg.value === '',
        `active-org cookie must be cleared by events.signOut handler (got: ${JSON.stringify(activeOrg)})`,
      ).toBe(true);
    },
  );
});
