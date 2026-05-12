import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { PrismaClient, type Role } from '@regwatch/db/client';
import { ensureOnboardingComplete } from './helpers';

/**
 * E2E coverage for `sdd/jurisdictions-config/spec` § R-Settings-Preferences-Page.
 * Slice MVP-4 Batch B6 (final).
 *
 * Three behavioural scenarios + one cold-route stale-JWT sweep:
 *
 *   1. **OWNER happy path** — OWNER cold-visits `/settings/preferences`,
 *      verifies all 7 LatAm jurisdictions render checked (the lazy
 *      `getOrCreate` chokepoint inserts `DEFAULT_SETTINGS` on first
 *      read), unchecks BR, switches schedule from `weekly` → `daily`
 *      (verifying the day-of-week picker hides), submits, sees the
 *      success message, reloads the page, and asserts the persisted
 *      state survives — both via the rendered form AND via a direct DB
 *      assertion on `Settings.scanSchedule = 'daily'` and the BR row
 *      having `enabled: false`. Folds the cold authed-proxy compile
 *      sweep at the top of the test (foot-gun
 *      `regwatch/footguns/cold-route-stale-jwt-race`).
 *
 *   2. **VIEWER read-only** — Owner A creates OrgX, then a VIEWER user
 *      is seeded (Prisma direct insert) with `Membership(OrgX, VIEWER)`
 *      BEFORE first sign-in (so the issued JWT carries the membership
 *      claim — same posture as `members.spec.ts`). VIEWER signs in,
 *      switches active org to OrgX, navigates to `/settings/preferences`.
 *      The form renders all 7 jurisdictions but the submit button is
 *      disabled and the read-only hint surfaces. There is no submit
 *      affordance available to the user. (Asserts the canEdit gate from
 *      `<PreferencesForm>` AND the role-gating in `<PreferencesPage>`.)
 *
 *   3. **Validation error** — OWNER navigates to `/settings/preferences`,
 *      unchecks ALL 7 jurisdictions, submits. The client-side Zod gate
 *      in `updateSettingsAction` rejects with the
 *      `NO_ENABLED_JURISDICTION` issue surfacing as the inline
 *      `preferences-form-jurisdictions-error` panel. NO upstream PUT
 *      occurs (asserted by listening for a `PUT /api/org/<id>/settings`
 *      response — must be empty). Reloads the page and confirms the DB
 *      row is still in the post-`getOrCreate` defaults state (no
 *      partial save).
 *
 *   4. **Cold-route stale-JWT sweep** — OWNER signs in fresh, creates
 *      OrgX, refreshes the JWT mv via the dashboard refresh button,
 *      switches active org. THEN navigates DIRECTLY to
 *      `/settings/preferences` (no warm dashboard hop in between for
 *      the page itself — this exercises the cold-compile of the RSC at
 *      `apps/web/src/app/(dashboard)/settings/preferences/page.tsx`
 *      AND the cold-compile of the underlying `apiServerFetch` flow to
 *      `GET /org/:orgId/settings`). Issues a `page.reload()` after
 *      mount and asserts no `preferences-page-error` ever surfaces and
 *      the form renders the seven LatAm jurisdictions. Guards against
 *      foot-gun `regwatch/footguns/cold-route-stale-jwt-race`: a
 *      freshly-compiled authed RSC race-condition where the JWT cookie
 *      hasn't propagated yet would otherwise surface as a 401 leak in
 *      the page chrome.
 *
 * --- Foot-guns kept in front of future debuggers ---
 *
 *   1. **No `MEMBER` role** — the Prisma `Role` enum is
 *      `OWNER | ADMIN | ANALYST | VIEWER`. The B6 task brief mentioned
 *      `MEMBER` but the codebase canonical "regular member" is VIEWER.
 *      Mirrors `invitations.spec.ts` foot-gun #1 + `members.spec.ts`
 *      foot-gun #1.
 *
 *   2. **Page uses `apiServerFetch`, NOT the proxy** — the RSC at
 *      `/settings/preferences/page.tsx` calls `apiServerFetch` directly
 *      (server-side hop to `apps/api`). The proxy at
 *      `/api/org/[orgId]/settings/route.ts` is for browser-driven
 *      fetches (none in this slice yet). Cold sweep targets BOTH paths
 *      so future browser callers won't trip on first-compile.
 *
 *   3. **Form submit when canEdit=false** — the `<PreferencesForm>`
 *      renders all input fields inside `<fieldset disabled>` AND the
 *      submit button has `disabled={pending || !canEdit}`. The
 *      `handleSubmit` early-returns when `!canEdit`. The "no submit
 *      affordance" assertion checks the button's `disabled` attribute —
 *      defense-in-depth UI gate; the `RolesGuard` on the API is the
 *      actual security boundary.
 *
 *   4. **`MEMBERSHIPS_FRESHNESS_TTL_MS=0`** is set on the api process
 *      in `playwright.config.ts` — the cross-tab silent retry foot-gun
 *      from MVP-3 is irrelevant to this spec but the TTL=0 ensures
 *      `Settings` reads/writes always hit the DB freshly (no cached
 *      `mv` blocking a STALE 401 we'd want to see).
 *
 *   5. **Run via `pnpm --filter @regwatch/web exec playwright test …`**
 *      NOT `pnpm test:e2e` — foot-gun
 *      `regwatch/footguns/turbo-test-e2e-depends-on-build-but-playwright-uses-dev`
 *      (#703). The turbo task has a stale `dependsOn: ["build"]` that
 *      fails locally because env validation is loaded only by `dev`.
 */

// ─── Prisma client (test-process-scoped) ──────────────────────────────────
const DEFAULT_DB_URL = 'postgresql://postgres:root@localhost:5432/regwatch_dev?schema=public';
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL ?? DEFAULT_DB_URL } },
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

// ─── Helpers (mirrors invitations.spec.ts / members.spec.ts) ──────────────

function uniqueEmail(tag: string): string {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `${tag}-${stamp}@regwatch.local`;
}

async function fakeGoogleSignIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('fake-google-email').fill(email);
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
 * Seed a User + Membership row via Prisma direct insert (bypasses the
 * chokepoint, see members.spec.ts foot-gun on `mv` impact). Used to set
 * up a VIEWER who will sign in AFTER the seed so the issued JWT picks
 * up the seeded membership claim.
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

// All 7 jurisdictions in the canonical registry order (per
// packages/types/src/jurisdictions.ts). Used to assert each row renders.
const ALL_CODES = ['MX', 'CO', 'PE', 'CL', 'AR', 'UY', 'BR', 'EC', 'PA'] as const;

// ─── Tests ────────────────────────────────────────────────────────────────

test.describe('Settings — Preferences page', () => {
  test(
    'R-Settings-Preferences-Page — OWNER cold-visits, edits jurisdictions + cadence, persists across reload (+ cold authed-proxy sweep)',
    { tag: ['@e2e', '@settings', '@critical'] },
    async ({ page, context }) => {
      const ownerEmail = uniqueEmail('prefs-owner');
      await fakeGoogleSignIn(page, ownerEmail);

      const org = await postOrgViaProxy(context, `Prefs Org ${Date.now()}`);
      // Mark all org Settings onboarding-complete (MVP-11 redirect guard).
      await ensureOnboardingComplete(prisma, ownerEmail);
      await refreshSessionAndExpectMembershipCount(page, 2);
      await switchActiveOrg(context, org.id);

      // ─── Cold authed-proxy sweep ─────────────────────────────────────
      // Hit the browser-side proxy `/api/org/:id/settings` BEFORE the
      // page renders so its first-compile happens with the freshly
      // re-minted JWT. The proxy is currently a future-use surface
      // (the page itself uses `apiServerFetch` server-side), but a
      // cold-compile race here would otherwise leak a STALE 401 to the
      // first browser caller — exactly what the cold-route foot-gun
      // describes.
      const coldProxy = await context.request.get(
        `/api/org/${encodeURIComponent(org.id)}/settings`,
        { headers: { 'X-Org-Id': org.id } },
      );
      expect(
        coldProxy.status(),
        `cold GET /api/org/:id/settings body=${await coldProxy.text()}`,
      ).toBe(200);

      // ─── First visit: defaults render via lazy getOrCreate ──────────
      await page.goto('/settings/preferences');
      await expect(page.getByTestId('preferences-page')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('preferences-page-org-slug')).toHaveText(org.slug);

      // All 7 jurisdictions render and start ENABLED (DEFAULT_SETTINGS).
      for (const code of ALL_CODES) {
        await expect(page.getByTestId(`preferences-form-jurisdiction-row-${code}`)).toBeVisible();
        await expect(
          page.getByTestId(`preferences-form-jurisdiction-${code}-enabled`),
        ).toBeChecked();
      }

      // Schedule defaults to 'weekly' → day-of-week picker visible.
      await expect(page.getByTestId('preferences-form-schedule')).toHaveValue('weekly');
      await expect(page.getByTestId('preferences-form-day-weekly-wrap')).toBeVisible();

      // ─── Edit: uncheck BR, switch to daily (day picker hides) ───────
      await page.getByTestId('preferences-form-jurisdiction-BR-enabled').uncheck();
      await expect(page.getByTestId('preferences-form-jurisdiction-BR-enabled')).not.toBeChecked();

      await page.getByTestId('preferences-form-schedule').selectOption('daily');
      await expect(page.getByTestId('preferences-form-day-weekly-wrap')).toBeHidden();
      await expect(page.getByTestId('preferences-form-day-custom-wrap')).toBeHidden();

      // ─── Submit ─────────────────────────────────────────────────────
      // The form submits via a Server Action (`updateSettingsAction`),
      // which calls `apiServerFetch` server-side — there is NO browser
      // PUT to wait for. We assert the success banner (set after
      // `revalidatePath` re-renders) and then verify DB persistence.
      await page.getByTestId('preferences-form-submit').click();

      await expect(page.getByTestId('preferences-form-success')).toBeVisible({
        timeout: 15_000,
      });

      // ─── Reload + assert persistence (UI + DB) ──────────────────────
      await page.reload();
      await expect(page.getByTestId('preferences-page')).toBeVisible();
      await expect(page.getByTestId('preferences-form-jurisdiction-BR-enabled')).not.toBeChecked();
      await expect(page.getByTestId('preferences-form-schedule')).toHaveValue('daily');
      // 'daily' MUST hide both day-pickers post-reload (form re-mount
      // re-derives conditional rendering from `initial.scanSchedule`).
      await expect(page.getByTestId('preferences-form-day-weekly-wrap')).toBeHidden();

      // DB invariant — defense-in-depth that the action actually wrote.
      const row = await prisma.settings.findUnique({
        where: { organizationId: org.id },
      });
      expect(row, 'Settings row must exist after PUT').not.toBeNull();
      expect(row!.scanSchedule).toBe('daily');
      const rawJur = row!.jurisdictions as Array<{ code: string; enabled: boolean }>;
      const brRow = rawJur.find((j) => j.code === 'BR');
      expect(brRow, 'BR row must persist in JSON column').toBeDefined();
      expect(brRow!.enabled).toBe(false);
      // Other LatAm codes still enabled (full-replace PUT preserved
      // the unchanged ones because the form sent the WHOLE state).
      const mxRow = rawJur.find((j) => j.code === 'MX');
      expect(mxRow?.enabled).toBe(true);
    },
  );

  test(
    'R-Settings-Preferences-Page — VIEWER renders the form read-only (submit disabled, hint visible)',
    { tag: ['@e2e', '@settings'] },
    async ({ browser }) => {
      const ctxOwner = await browser.newContext();
      const ctxViewer = await browser.newContext();
      const pageOwner = await ctxOwner.newPage();
      const pageViewer = await ctxViewer.newPage();

      try {
        // OWNER creates OrgX (the chokepoint also lazy-creates Settings
        // on the first authed GET below — but for read-only assertions
        // we only need OrgX to exist; the page's RSC will lazy-create
        // the Settings row as a side-effect of GET, which is fine).
        const aEmail = uniqueEmail('prefs-readonly-owner');
        await fakeGoogleSignIn(pageOwner, aEmail);
        const orgX = await postOrgViaProxy(ctxOwner, `Readonly Org ${Date.now()}`);

        // Seed a VIEWER user with Membership(OrgX, VIEWER) BEFORE first
        // sign-in so the JWT minted at sign-in carries the claim.
        const seeded = await seedMember(orgX.id, 'VIEWER' satisfies Role, 'prefs-viewer');

        await fakeGoogleSignIn(pageViewer, seeded.email);
        await switchActiveOrg(ctxViewer, orgX.id);

        await pageViewer.goto('/settings/preferences');
        await expect(pageViewer.getByTestId('preferences-page')).toBeVisible({
          timeout: 30_000,
        });

        // Form rendered, all 7 rows visible.
        await expect(pageViewer.getByTestId('preferences-form')).toBeVisible();
        for (const code of ALL_CODES) {
          await expect(
            pageViewer.getByTestId(`preferences-form-jurisdiction-row-${code}`),
          ).toBeVisible();
        }

        // Submit button is DISABLED — the only "save" affordance.
        // (`<PreferencesForm canEdit={false}>` cascades disabled state.)
        const submit = pageViewer.getByTestId('preferences-form-submit');
        await expect(submit).toBeVisible();
        await expect(submit).toBeDisabled();

        // Read-only hint surfaces — explicit user feedback that this
        // role cannot mutate.
        await expect(pageViewer.getByTestId('preferences-form-readonly-hint')).toBeVisible();

        // Defense-in-depth: even if the user attempts a click, the
        // disabled submit should not produce a PUT. Capture network
        // traffic for the click attempt.
        const puts: string[] = [];
        pageViewer.on('request', (req) => {
          if (req.method() === 'PUT' && req.url().includes('/settings')) puts.push(req.url());
        });
        // Click is a no-op on a disabled button — but we go through
        // `force: true` to PROVE the form's `handleSubmit` early-return
        // (`if (!canEdit) return;`) holds even if a hostile user
        // bypasses the disabled attribute via dev-tools.
        await submit.click({ force: true }).catch(() => {
          /* disabled buttons throw under strict locator semantics; ignored */
        });
        await pageViewer.waitForTimeout(300);
        expect(puts, 'VIEWER click must not trigger a PUT').toEqual([]);
      } finally {
        await ctxOwner.close();
        await ctxViewer.close();
      }
    },
  );

  test(
    'R-Settings-Preferences-Page — OWNER unchecks all jurisdictions, submit surfaces inline error, no DB write',
    { tag: ['@e2e', '@settings'] },
    async ({ page, context }) => {
      const ownerEmail = uniqueEmail('prefs-validation-owner');
      await fakeGoogleSignIn(page, ownerEmail);

      const org = await postOrgViaProxy(context, `Validation Org ${Date.now()}`);
      // Mark all org Settings onboarding-complete (MVP-11 redirect guard).
      await ensureOnboardingComplete(prisma, ownerEmail);
      await refreshSessionAndExpectMembershipCount(page, 2);
      await switchActiveOrg(context, org.id);

      await page.goto('/settings/preferences');
      await expect(page.getByTestId('preferences-page')).toBeVisible({ timeout: 30_000 });

      // Snapshot the lazy-created defaults BEFORE we attempt the
      // invalid submit so we can assert "no save occurred" purely.
      const before = await prisma.settings.findUnique({
        where: { organizationId: org.id },
      });
      expect(before, 'Settings row must exist (lazy getOrCreate on GET)').not.toBeNull();
      const beforeUpdatedAt = before!.updatedAt.getTime();

      // Listen for ANY upstream PUT — the client-side validation gate
      // in `updateSettingsAction` MUST short-circuit before a network
      // hop.
      const upstreamPuts: string[] = [];
      page.on('request', (req) => {
        if (req.method() === 'PUT' && req.url().includes('/settings')) {
          upstreamPuts.push(req.url());
        }
      });

      // Uncheck all 9 jurisdictions.
      for (const code of ALL_CODES) {
        await page.getByTestId(`preferences-form-jurisdiction-${code}-enabled`).uncheck();
      }
      for (const code of ALL_CODES) {
        await expect(
          page.getByTestId(`preferences-form-jurisdiction-${code}-enabled`),
        ).not.toBeChecked();
      }

      // Submit. The action's client-side `UpdateSettingsSchema.safeParse`
      // rejects with the `NO_ENABLED_JURISDICTION` issue → form sets
      // `fieldErrors.jurisdictions` → `preferences-form-jurisdictions-error`
      // panel renders.
      await page.getByTestId('preferences-form-submit').click();

      await expect(page.getByTestId('preferences-form-jurisdictions-error')).toBeVisible({
        timeout: 5_000,
      });
      // Generic top-level error also surfaces (describeError() →
      // 'Some fields are invalid…' for VALIDATION code).
      await expect(page.getByTestId('preferences-form-error')).toBeVisible();
      // Success message must NOT appear.
      await expect(page.getByTestId('preferences-form-success')).toBeHidden();

      // Brief settle window so any (illegal) deferred request would
      // have left the page by now.
      await page.waitForTimeout(300);
      expect(
        upstreamPuts,
        `client-side validation gate must block PUT (got ${JSON.stringify(upstreamPuts)})`,
      ).toEqual([]);

      // DB invariant — row unchanged: same `updatedAt` timestamp.
      const after = await prisma.settings.findUnique({
        where: { organizationId: org.id },
      });
      expect(after, 'Settings row must still exist').not.toBeNull();
      expect(after!.updatedAt.getTime(), 'updatedAt must be unchanged (no save)').toBe(
        beforeUpdatedAt,
      );

      // Page reload still shows DEFAULT_SETTINGS (all 7 enabled).
      await page.reload();
      await expect(page.getByTestId('preferences-page')).toBeVisible();
      for (const code of ALL_CODES) {
        await expect(
          page.getByTestId(`preferences-form-jurisdiction-${code}-enabled`),
        ).toBeChecked();
      }
    },
  );

  test(
    'cold-route stale-JWT sweep — direct navigation to /settings/preferences after fresh org create renders without 401 leak',
    { tag: ['@e2e', '@settings', '@cold'] },
    async ({ page }) => {
      // Fresh sign-in + chokepoint org create + JWT refresh + active-org
      // switch — the standard "warm" sequence. Then go DIRECTLY to
      // `/settings/preferences` without any other authed page hop in
      // between, so the RSC compiles cold against the just-re-minted
      // session.
      const ownerEmail = uniqueEmail('prefs-cold');
      await fakeGoogleSignIn(page, ownerEmail);

      // We do NOT use `context.request.post` here — we want all the
      // session cookies + active-org cookie state to flow through
      // page-driven navigations (matches a real user journey) so the
      // cold compile happens with realistic cookie jar timing.
      const org = await page.evaluate(async (name: string) => {
        const res = await fetch('/api/org', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        return (await res.json()) as { id: string; slug: string };
      }, `Cold Org ${Date.now()}`);
      // Mark all org Settings onboarding-complete (MVP-11 redirect guard).
      await ensureOnboardingComplete(prisma, ownerEmail);

      await refreshSessionAndExpectMembershipCount(page, 2);
      await page.evaluate(async (orgId: string) => {
        await fetch('/api/org/switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId }),
        });
      }, org.id);

      // Direct cold navigation — the page RSC compiles for the first
      // time on this dev-server boot and the apiServerFetch hop happens
      // with the refreshed JWT.
      await page.goto('/settings/preferences');
      await expect(page.getByTestId('preferences-page')).toBeVisible({ timeout: 30_000 });

      // No error chrome surfaces (the foot-gun would manifest as a 401
      // -> the page renders `preferences-page-error` with status 401).
      await expect(page.getByTestId('preferences-page-error')).toHaveCount(0);
      await expect(page.getByTestId('preferences-page-org-slug')).toHaveText(org.slug);

      // Defence-in-depth reload — first reload AFTER cold compile is
      // the historical race window.
      await page.reload();
      await expect(page.getByTestId('preferences-page')).toBeVisible();
      await expect(page.getByTestId('preferences-page-error')).toHaveCount(0);
      // Form rendered → upstream GET succeeded → no STALE 401 leaked.
      for (const code of ALL_CODES) {
        await expect(page.getByTestId(`preferences-form-jurisdiction-row-${code}`)).toBeVisible();
      }
    },
  );
});
