import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { Prisma, PrismaClient, ScanStatus } from '@regwatch/db/client';
import { ensureOnboardingComplete } from './helpers';

/**
 * E2E coverage for `sdd/scanner-vertical-ar/spec` § R-13-UsageWidget.
 * Slice MVP-5 Batch B9.3.
 *
 * Three render variants of `<UsageWidget>` mounted by the
 * `/settings/usage` RSC page, hitting the real apps/api
 * `GET /org/:orgId/usage/current` controller through the
 * `apiServerFetch` server-side path:
 *
 *   1. **Zero usage** — fresh org, no `ScanLog` rows. Widget renders
 *      `"$0.00 / $10.00 (0%)"` (R-13 S1 literal contract); cap-reached
 *      indicator is absent.
 *   2. **Mid usage (~50%)** — seed two COMPLETED scans summing to
 *      `$5.00`. Widget renders `"$5.00 / $10.00 (50%)"`; no cap-reached.
 *   3. **At-cap (100%)** — seed two COMPLETED scans summing to exactly
 *      the `$10` cap. Widget renders `"$10.00 / $10.00 (100%)"` AND
 *      shows `data-testid="usage-widget-cap-reached"` (R-13 S2).
 *
 * --- Setup notes ---
 *
 * Pattern mirrors `members.spec.ts`:
 *   1. Sign in via fake-google + unique email per spec → fresh user.
 *   2. `POST /api/org` (chokepoint) creates a non-personal org and
 *      bumps the user's `mv` → must refresh session before any
 *      org-scoped read or `MembershipFreshnessGuard` 401s.
 *   3. `POST /api/org/switch` flips the active-org cookie so the
 *      `/settings/usage` page resolves the seeded org (and not the
 *      auto-created personal org, which has zero scans for every test).
 *   4. Seed `ScanLog` rows directly via Prisma — bypasses any apps/api
 *      mutation path (none exists at the wire boundary in MVP-5;
 *      scans land via the apps/scanner cron loop). The aggregation
 *      reads happen from a SEPARATE process (apps/api) on the next
 *      page navigation, so the seeds are visible without any cache
 *      invalidation hop (INV-UT-2: "no caching MVP-5").
 *
 * --- Foot-guns kept in-file ---
 *
 * 1. `B9 carry-forward` — `playwright.config.ts` MUST set
 *    `REGISTRATION_ENABLED: '1'` on the web webServer or every
 *    `fakeGoogleSignIn(uniqueEmail)` here trips
 *    `auth-registration-gate.ts isSignInAllowed()` (B8 default closed
 *    public registration). See foot-gun
 *    `regwatch/footguns/playwright-config-missing-registration-enabled-after-b8`.
 *
 * 2. `Decimal precision` — apps/api serialises `costUsd` / `capUsd`
 *    as Decimal-stringified values (`"5"`, `"10"`, NOT `"5.00"`).
 *    `<UsageWidget>` formats via `Number.parseFloat(...).toFixed(2)`,
 *    so the EXPECTED rendered string is `"$5.00 / $10.00 (50%)"`.
 *    Asserting against the upstream value would fail.
 *
 * 3. `Foot-gun #687 carry-forward` — vitest specs share
 *    `regwatch_dev`. We scope ALL `prisma.scanLog.*` calls to the
 *    seeded `organizationId` so parallel B9 runs do not leak.
 *
 * 4. `MEMBERSHIPS_FRESHNESS_TTL_MS=0` set in `playwright.config.ts`
 *    api webServer means the freshness cache is OFF — the
 *    `refreshSessionAndExpectMembershipCount` hop is required after
 *    every chokepoint write here, same as `members.spec.ts`.
 */

// ─── Prisma client (test-process-scoped) ─────────────────────────────
//
// Mirrors `members.spec.ts` and the api integration spec — keeps tests
// runnable without exporting `DATABASE_URL` in the shell.
const DEFAULT_DB_URL = 'postgresql://postgres:root@localhost:5432/regwatch_dev?schema=public';
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL ?? DEFAULT_DB_URL } },
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

// ─── Helpers (lift-and-adapt from members.spec.ts) ───────────────────

function uniqueEmail(tag: string): string {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `${tag}-${stamp}@regwatch.local`;
}

async function fakeGoogleSignIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('fake-google-email').fill(email);
  // Foot-gun #2 (org-switcher.spec.ts) carry-forward — wait for the
  // POST so `waitForURL` does not race the redirect.
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
 * Seed N completed `ScanLog` rows in the current month for `orgId`.
 * `costUsd` accepts a stringified decimal (e.g. `"2.50"`) per INV-SP-3
 * — `Prisma.Decimal` round-trips lossless. `startedAt` defaults to
 * `now()` which is always within `startOfMonthUtc(now)..now`, the
 * window the apps/api `getMonthlyUsage` helper sums over.
 */
async function seedScanLogs(orgId: string, costsUsd: ReadonlyArray<string>): Promise<void> {
  await prisma.scanLog.createMany({
    data: costsUsd.map((cost) => ({
      organizationId: orgId,
      jurisdiction: 'AR',
      status: ScanStatus.COMPLETED,
      tokensUsed: 0,
      costUsd: new Prisma.Decimal(cost),
      completedAt: new Date(),
    })),
  });
}

/**
 * Drive `/settings/usage`, wait for the widget to mount, and return
 * the rendered numeric overlay + cap-reached visibility.
 */
async function readUsageWidget(
  page: Page,
): Promise<{ numbers: string; capReachedVisible: boolean }> {
  await page.goto('/settings/usage');
  await expect(page.getByTestId('usage-page')).toBeVisible();
  // Surface the upstream error (4xx/5xx from apps/api) instead of
  // hanging on the widget that never mounts.
  await expect(page.getByTestId('usage-page-error')).toHaveCount(0);
  await expect(page.getByTestId('usage-widget')).toBeVisible();
  const numbers = (await page.getByTestId('usage-widget-numbers').textContent())?.trim();
  if (!numbers) throw new Error('usage-widget-numbers had no text');
  const capReachedVisible = (await page.getByTestId('usage-widget-cap-reached').count()) > 0;
  return { numbers, capReachedVisible };
}

// ─── Tests ───────────────────────────────────────────────────────────

test.describe('R-13-UsageWidget — render variants', () => {
  test('S1: zero usage renders "$0.00 / $10.00 (0%)" without cap indicator', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const email = uniqueEmail('usage-zero');
    await fakeGoogleSignIn(page, email);

    const org = await postOrgViaProxy(context, `Usage Zero ${Date.now()}`);
    // Mark all org Settings onboarding-complete (MVP-11 redirect guard).
    await ensureOnboardingComplete(prisma, email);
    await refreshSessionAndExpectMembershipCount(page, 2);
    await switchActiveOrg(context, org.id);

    const { numbers, capReachedVisible } = await readUsageWidget(page);
    expect(numbers).toBe('$0.00 / $10.00 (0%)');
    expect(capReachedVisible).toBe(false);

    await context.close();
  });

  test('S-mid: $5.00 across 2 scans renders "$5.00 / $10.00 (50%)" without cap indicator', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const email = uniqueEmail('usage-mid');
    await fakeGoogleSignIn(page, email);

    const org = await postOrgViaProxy(context, `Usage Mid ${Date.now()}`);
    // Mark all org Settings onboarding-complete (MVP-11 redirect guard).
    await ensureOnboardingComplete(prisma, email);
    await refreshSessionAndExpectMembershipCount(page, 2);
    await switchActiveOrg(context, org.id);

    // Two COMPLETED scans summing to $5.00 — exercises SUM aggregation
    // path and proves the widget reflects multi-row state, not a
    // single-row latest-write.
    await seedScanLogs(org.id, ['2.50', '2.50']);

    const { numbers, capReachedVisible } = await readUsageWidget(page);
    expect(numbers).toBe('$5.00 / $10.00 (50%)');
    expect(capReachedVisible).toBe(false);

    await context.close();
  });

  test('S2: $10.00 (at cap) renders "$10.00 / $10.00 (100%)" WITH cap-reached indicator', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const email = uniqueEmail('usage-cap');
    await fakeGoogleSignIn(page, email);

    const org = await postOrgViaProxy(context, `Usage Cap ${Date.now()}`);
    // Mark all org Settings onboarding-complete (MVP-11 redirect guard).
    await ensureOnboardingComplete(prisma, email);
    await refreshSessionAndExpectMembershipCount(page, 2);
    await switchActiveOrg(context, org.id);

    // Sum exactly to MONTHLY_CAP_USD ($10) so `isAtCap === true`
    // (helper uses `>=`). The cap-reached indicator MUST appear.
    await seedScanLogs(org.id, ['7.00', '3.00']);

    const { numbers, capReachedVisible } = await readUsageWidget(page);
    expect(numbers).toBe('$10.00 / $10.00 (100%)');
    expect(capReachedVisible).toBe(true);

    await context.close();
  });
});
