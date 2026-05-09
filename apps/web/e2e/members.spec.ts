import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { PrismaClient, type Role } from '@regwatch/db/client';
import { ensureOnboardingComplete } from './helpers';

/**
 * E2E coverage for `sdd/org-members/spec` § R-Members-List, R-Membership-Update,
 * R-Membership-Remove, R-Jwt-Invalidate-Cross-User. Slice MVP-3b3a Batch B7.
 *
 * Four scenarios:
 *   1. Owner removes a member from a non-personal org → row count drops.
 *   2. Self-leave on a non-personal org → active org switches to personalOrg,
 *      `router.replace('/dashboard')` lands the user authenticated (NO sign-out).
 *   3. **Cross-tab silent retry**: Tab A promotes Tab B's user via PATCH,
 *      bumping B's `User.membershipsVersion`. Tab B's next `apiFetch`
 *      returns 401 STALE_MEMBERSHIPS, the wrapper calls `session.update({})`,
 *      retries, and the SAME request now returns 200 — without the user
 *      noticing. Asserted by inspecting the response status sequence on
 *      `/api/org/me` (must contain a 401 followed by a 200).
 *   4. Last-OWNER cannot self-leave → 409 surfaces inline as
 *      `leave-org-dialog-error`; user stays on /settings/members.
 *
 * --- Setup notes ---
 *
 * No backend "add member" endpoint exists in this slice (invitations land in
 * MVP-3b3b). We seed Memberships directly via Prisma. Direct seeds do NOT
 * bump `User.membershipsVersion` (the chokepoint isn't on this path) — that
 * is fine because the seeded users either never sign in (only admin
 * mutations target them) or they sign in AFTER the seed and the JWT
 * callback then reads the now-up-to-date memberships from DB.
 *
 * The owner of every test org goes through `POST /api/org` (chokepoint),
 * which DOES bump their `mv`. The fresh JWT must therefore be re-minted
 * via the dashboard "Refresh session" button BEFORE any org-scoped call —
 * otherwise `MembershipFreshnessGuard` 401s on the next request. Same
 * pattern as `org-switcher.spec.ts`.
 *
 * --- B7 foot-guns (kept here so future debuggers don't re-investigate) ---
 *
 * 1. `Role` enum: `OWNER | ADMIN | ANALYST | VIEWER` — there is NO `MEMBER`
 *    role in the Prisma schema. Use `VIEWER` for the "regular member" case.
 *
 * 2. PATCH/DELETE `/api/org/[orgId]/members/[userId]` proxies to apps/api;
 *    the upstream `OrgScopeGuard` requires the `X-Org-Id` header. The proxy
 *    forwards it ONLY when present on the inbound request — the helper
 *    `patchMemberRole` sets it explicitly.
 *
 * 3. `LAST_OWNER` is 409, `PERSONAL_ORG_UNREMOVABLE` is 400 — the action
 *    layer surfaces both as `MembersActionResult.code` regardless of status.
 *    Inline copy is the canonical message from `describeActionError`.
 *
 * 4. `useSession().update({})` is mandatory (foot-gun #670). The
 *    `<LeaveOrgButton>` calls it after a successful leave so the JWT loses
 *    the now-revoked membership — the test waits for the membership-count
 *    transition on /dashboard to confirm the JWT was re-minted.
 *
 * 5. Cross-tab retry: the silent retry happens inside `apiFetch` (CLIENT).
 *    `apiServerFetch` (RSC / server actions) does NOT retry — so the
 *    natural trigger in Tab B is `<DashboardClient>` `useEffect` calling
 *    `apiFetch('/api/org/me')`. We force a re-mount via `page.reload()`.
 */

// ─── Prisma client (test-process-scoped) ──────────────────────────────────
//
// Mirror `playwright.config.ts`'s default — keeps tests runnable without
// requiring `DATABASE_URL` to be exported in the shell. CI overrides via env.
const DEFAULT_DB_URL = 'postgresql://postgres:root@localhost:5432/regwatch_dev?schema=public';
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL ?? DEFAULT_DB_URL } },
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

// ─── Helpers ──────────────────────────────────────────────────────────────

function uniqueEmail(tag: string): string {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `${tag}-${stamp}@regwatch.local`;
}

async function fakeGoogleSignIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('fake-google-email').fill(email);
  // `org-switcher.spec.ts` foot-gun #1 carry-forward — wait for the action POST.
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
  const res = await context.request.post('/api/org', {
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({ name }),
  });
  expect(res.status(), `POST /api/org body=${await res.text()}`).toBe(201);
  return (await res.json()) as CreateOrgResponse;
}

async function switchActiveOrg(context: BrowserContext, orgId: string): Promise<void> {
  const res = await context.request.post('/api/org/switch', {
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({ orgId }),
  });
  expect(res.status(), `POST /api/org/switch body=${await res.text()}`).toBe(204);
}

/**
 * Re-mint the JWT through the dashboard "Refresh session" button. Required
 * after any chokepoint write (POST /api/org, PATCH/DELETE members) for the
 * SAME user, because `MembershipFreshnessGuard` rejects requests whose JWT
 * `mv` is older than the DB row.
 *
 * The membership-count testid flipping value is the deterministic signal
 * that `update({})` resolved AND `router.refresh()` re-ran the RSC.
 */
async function refreshSessionAndExpectMembershipCount(page: Page, expected: number): Promise<void> {
  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-section')).toBeVisible();
  await expect(page.getByTestId('dashboard-hydrated')).toHaveText('yes');
  await page.getByTestId('dashboard-refresh-session').click();
  await expect(page.getByTestId('dashboard-membership-count')).toHaveText(String(expected), {
    timeout: 10_000,
  });
}

/**
 * Seed a User + Membership row directly via Prisma. The seeded User does
 * NOT have a personalOrg (we never sign in as them), and the Membership
 * write bypasses the chokepoint — the user's `mv` stays at 0. That's fine
 * because:
 *   - For tests 1 + 2: the seed targets are mutated by an OWNER from
 *     another browser session; their freshness only matters if/when they
 *     authenticate, which they don't here.
 *   - For test 3: the seed creates the eventually-signed-in user's
 *     membership in OrgX BEFORE first sign-in, so the JWT issued at
 *     sign-in carries the seeded membership claim from the start.
 */
async function seedMember(
  organizationId: string,
  role: Role,
  emailTag: string,
): Promise<{ userId: string; email: string }> {
  const email = uniqueEmail(emailTag);
  const user = await prisma.user.create({
    data: { email, name: `Seed ${emailTag}` },
  });
  await prisma.membership.create({
    data: { userId: user.id, organizationId, role },
  });
  return { userId: user.id, email };
}

/**
 * Server-to-server PATCH on the proxy from a signed-in browser context.
 * `X-Org-Id` is REQUIRED — upstream `OrgScopeGuard` rejects without it
 * (foot-gun #2 above). `context.request` shares the cookie jar with the
 * page, so the proxy mints `Authorization: Bearer <jwt>` from the cookie.
 */
async function patchMemberRole(
  context: BrowserContext,
  orgId: string,
  userId: string,
  role: Role,
): Promise<void> {
  const res = await context.request.patch(
    `/api/org/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
    {
      headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId },
      data: JSON.stringify({ role }),
    },
  );
  expect(res.status(), `PATCH role body=${await res.text()}`).toBe(204);
}

async function readActiveOrgFromDashboard(page: Page): Promise<string> {
  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-hydrated')).toHaveText('yes');
  const text = await page.getByTestId('dashboard-active-org').textContent();
  expect(text, 'dashboard-active-org must be present').toBeTruthy();
  return (text ?? '').trim();
}

// ─── Tests ────────────────────────────────────────────────────────────────

test.describe('Members management', () => {
  test(
    'R-Membership-Remove — owner removes a member from a non-personal org',
    { tag: ['@e2e', '@members'] },
    async ({ page, context }) => {
      const ownerEmail = uniqueEmail('owner');
      await fakeGoogleSignIn(page, ownerEmail);

      // Create the test org via chokepoint → bumps owner.mv → JWT lags by 1.
      const org = await postOrgViaProxy(context, `Members Test ${Date.now()}`);
      // Mark all org Settings as onboarding-complete so the dashboard layout
      // redirect guard (MVP-11) does not redirect to /onboarding.
      await ensureOnboardingComplete(prisma, ownerEmail);

      // Seed two viewers directly. mv on these users stays 0 — irrelevant
      // because they never sign in.
      const m1 = await seedMember(org.id, 'VIEWER', 'mem1');
      await seedMember(org.id, 'VIEWER', 'mem2');

      // Re-mint the OWNER's JWT (mv claim) BEFORE org-scoped reads — the
      // /settings/members RSC fetches via apiServerFetch which does NOT
      // retry on STALE.
      await refreshSessionAndExpectMembershipCount(page, 2);
      await switchActiveOrg(context, org.id);

      await page.goto('/settings/members');
      await expect(page.getByTestId('members-page')).toBeVisible();
      await expect(page.getByTestId('members-list')).toBeVisible();

      // Three rows: owner + 2 seeded viewers.
      const rows = page.locator('[data-testid^="member-row-"][data-testid$=""]').filter({
        has: page.locator('td'),
      });
      // The above selector also matches member-row-self-X / member-row-error-X
      // wrappers — narrow to <tr> by walking through tbody.
      const tbodyRows = page.locator('[data-testid="members-list"] tbody tr');
      await expect(tbodyRows).toHaveCount(3);

      // Open kebab → click Remove → confirm.
      await page.getByTestId(`member-row-menu-${m1.userId}`).click();
      await page.getByTestId(`member-row-remove-trigger-${m1.userId}`).click();
      await expect(page.getByTestId(`remove-member-dialog-${m1.userId}`)).toBeVisible();

      // Wait for the Server Action POST + revalidate → row disappears.
      await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/settings/members') && r.request().method() === 'POST',
          { timeout: 15_000 },
        ),
        page.getByTestId(`remove-member-dialog-confirm-${m1.userId}`).click(),
      ]);

      await expect(page.getByTestId(`member-row-${m1.userId}`)).toBeHidden({ timeout: 10_000 });
      await expect(tbodyRows).toHaveCount(2);
      // Touch unused locator binding to silence noUnusedLocals if linted.
      void rows;
    },
  );

  test(
    'R-Membership-Remove — self-leave on non-personal org switches active to personalOrg, no sign-out',
    { tag: ['@e2e', '@members', '@critical'] },
    async ({ page, context }) => {
      const ownerEmail = uniqueEmail('leaver');
      await fakeGoogleSignIn(page, ownerEmail);
      // Mark personal org onboarding complete before visiting /dashboard.
      await ensureOnboardingComplete(prisma, ownerEmail);

      const personalOrgId = await readActiveOrgFromDashboard(page);
      expect(personalOrgId).toBeTruthy();

      const other = await postOrgViaProxy(context, `Leavable Org ${Date.now()}`);
      // Mark new org onboarding complete so switching to it doesn't redirect.
      await ensureOnboardingComplete(prisma, ownerEmail);

      // Seed a co-OWNER so the leaver is NOT the last OWNER. Direct write
      // is sufficient because the co-OWNER never signs in here — server
      // counts OWNERs by row, not by JWT freshness.
      await seedMember(other.id, 'OWNER', 'co-owner');

      await refreshSessionAndExpectMembershipCount(page, 2);
      await switchActiveOrg(context, other.id);

      await page.goto('/settings/members');
      await expect(page.getByTestId('members-page')).toBeVisible();
      await expect(page.getByTestId('members-page-org-slug')).toHaveText(other.slug);

      // Trigger leave → confirm.
      await page.getByTestId('leave-org-button').click();
      await expect(page.getByTestId('leave-org-dialog')).toBeVisible();
      await page.getByTestId('leave-org-dialog-confirm').click();

      // The button calls `router.replace('/dashboard')` after `session.update({})`.
      await page.waitForURL((url) => url.pathname === '/dashboard', { timeout: 15_000 });
      // Force a fresh layout render so the updated session cookie (re-minted by
      // `session.update({})` in the leave button) is read by the RSC layout.
      // Without this reload, when /dashboard is rendered cold (test run in
      // isolation, before any other test warms it up) the layout occasionally
      // captures the JWT cookie state from BEFORE the update propagated to
      // the browser jar, leaving the membership count stale at 2.
      // Foot-gun: `regwatch/footguns/router-replace-after-session-update-can-render-stale-jwt`.
      await page.reload();
      await expect(page.getByTestId('dashboard-section')).toBeVisible();

      // JWT was re-minted: now only the personal-org membership survives.
      await expect(page.getByTestId('dashboard-membership-count')).toHaveText('1', {
        timeout: 10_000,
      });
      await expect(page.getByTestId('dashboard-active-org')).toHaveText(personalOrgId);

      // No sign-out — session cookie still present.
      const cookies = await context.cookies();
      const session = cookies.find(
        (c) => c.name === 'authjs.session-token' || c.name === '__Secure-authjs.session-token',
      );
      expect(session, 'session cookie must persist after self-leave').toBeDefined();
      expect(session!.value.length).toBeGreaterThan(20);
    },
  );

  test(
    'R-Jwt-Invalidate-Cross-User — Tab A promotes Tab B; Tab B apiFetch silently retries via session.update({})',
    { tag: ['@e2e', '@members', '@critical'] },
    async ({ browser }: { browser: Browser }) => {
      // Two independent cookie jars — required to drive the cross-tab path.
      const ctxA = await browser.newContext();
      const ctxB = await browser.newContext();
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      try {
        // Tab A: sign in, create OrgX (A is OWNER), refresh JWT mv.
        const aEmail = uniqueEmail('admin-a');
        await fakeGoogleSignIn(pageA, aEmail);
        const orgX = await postOrgViaProxy(ctxA, `Cross-Tab Org ${Date.now()}`);
        // Mark onboarding complete for A (includes OrgX) so the dashboard
        // redirect guard doesn't fire for either Tab A or Tab B (who will
        // switch active org to OrgX).
        await ensureOnboardingComplete(prisma, aEmail);
        await refreshSessionAndExpectMembershipCount(pageA, 2);

        // Tab B: pre-seed B's User + Membership(OrgX, VIEWER) BEFORE B signs in.
        // First sign-in's JWT will pick up the seeded claim.
        const bEmail = uniqueEmail('member-b');
        const bUser = await prisma.user.create({
          data: { email: bEmail, name: 'Member B' },
        });
        await prisma.membership.create({
          data: { userId: bUser.id, organizationId: orgX.id, role: 'VIEWER' },
        });

        // Capture /api/org/me responses for the entire B-flow. The
        // `dashboard-me` testid renders `me.orgSlug` but `OrgMeBody` in
        // dashboard-client uses a stale shape (`orgSlug` lives under
        // `memberships[i]`, not at the root) — pre-existing latent UI
        // bug outside this slice. We instead watch the wire directly:
        // the silent-retry signature is observable as a 401→200 status
        // sequence on `/api/org/me`.
        // See foot-gun: `regwatch/footguns/dashboard-me-orgmebody-stale-shape`.
        const meStatuses: number[] = [];
        const meListener = (response: import('@playwright/test').Response): void => {
          if (response.url().includes('/api/org/me') && response.request().method() === 'GET') {
            meStatuses.push(response.status());
          }
        };
        pageB.on('response', meListener);

        await fakeGoogleSignIn(pageB, bEmail);
        // B's personal org also needs onboarding marked complete.
        await ensureOnboardingComplete(prisma, bEmail);
        await switchActiveOrg(ctxB, orgX.id);
        await pageB.goto('/dashboard');
        await expect(pageB.getByTestId('dashboard-section')).toBeVisible();
        await expect(pageB.getByTestId('dashboard-hydrated')).toHaveText('yes');

        // Tab B's JWT is fresh (just signed in with seeded membership) →
        // expect at least one healthy 200 to confirm the baseline before
        // we promote.
        await expect.poll(() => meStatuses.includes(200), { timeout: 15_000 }).toBe(true);

        // Tab A: PATCH B from VIEWER → ADMIN. Chokepoint bumps B.mv on DB.
        // Tab B's JWT mv is now stale.
        await switchActiveOrg(ctxA, orgX.id);
        await patchMemberRole(ctxA, orgX.id, bUser.id, 'ADMIN');

        // Snapshot the index BEFORE the reload so we only assert the
        // silent-retry signature on the post-promotion fetches.
        const baselineLen = meStatuses.length;

        // Re-mount DashboardClient → useEffect re-fires apiFetch('/api/org/me').
        // First fetch: stale JWT → 401 STALE_MEMBERSHIPS.
        // apiFetch.ts: triggerSessionUpdate() → cookie re-mint with mv+1.
        // Retry fetch: 200.
        await pageB.reload();
        await expect(pageB.getByTestId('dashboard-section')).toBeVisible();
        await expect(pageB.getByTestId('dashboard-hydrated')).toHaveText('yes');

        // Wait until we've observed both a 401 and a subsequent 200
        // after the reload — that IS the silent-retry signature.
        await expect
          .poll(
            () => {
              const after = meStatuses.slice(baselineLen);
              const first401 = after.indexOf(401);
              if (first401 === -1) return false;
              return after.slice(first401 + 1).includes(200);
            },
            {
              timeout: 15_000,
              message: 'expected 401 → 200 on /api/org/me after promotion',
            },
          )
          .toBe(true);

        pageB.off('response', meListener);

        const after = meStatuses.slice(baselineLen);
        expect(
          after,
          `expected 401 → 200 sequence on /api/org/me (got ${JSON.stringify(after)})`,
        ).toContain(401);
        expect(after[after.length - 1]).toBe(200);
      } finally {
        await ctxA.close();
        await ctxB.close();
      }
    },
  );

  test(
    'R-Membership-Remove — last-OWNER cannot self-leave (409 LAST_OWNER surfaces inline)',
    { tag: ['@e2e', '@members'] },
    async ({ page, context }) => {
      const email = uniqueEmail('solo-owner');
      await fakeGoogleSignIn(page, email);

      const solo = await postOrgViaProxy(context, `Solo Org ${Date.now()}`);
      // Mark all org Settings onboarding-complete (personal + solo).
      await ensureOnboardingComplete(prisma, email);

      // No co-OWNER seeded → user is the LAST OWNER → DELETE rejected with 409.
      await refreshSessionAndExpectMembershipCount(page, 2);
      await switchActiveOrg(context, solo.id);

      await page.goto('/settings/members');
      await expect(page.getByTestId('members-page')).toBeVisible();

      await page.getByTestId('leave-org-button').click();
      await expect(page.getByTestId('leave-org-dialog')).toBeVisible();
      await page.getByTestId('leave-org-dialog-confirm').click();

      // Action returns LAST_OWNER → dialog stays open with the canonical
      // copy from `describeActionError` (member-row.tsx).
      const errorEl = page.getByTestId('leave-org-dialog-error');
      await expect(errorEl).toBeVisible({ timeout: 10_000 });
      await expect(errorEl).toHaveText(/last OWNER/i);

      // User remains on the members page (NO redirect).
      expect(new URL(page.url()).pathname).toBe('/settings/members');
      await expect(page.getByTestId('leave-org-dialog')).toBeVisible();
    },
  );
});
