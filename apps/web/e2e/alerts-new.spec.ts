import { expect, test } from '@playwright/test';

/**
 * E2E coverage for `sdd/manual-ingestion/spec` § R-10 (Manual ingestion UI).
 *
 * Spec scenarios:
 *   S1: successful URL submission → redirect to /dashboard
 *   S2: empty jurisdiction → inline error, Server Action NOT called
 *
 * These tests require:
 *   - apps/web running on the configured base URL
 *   - apps/api running and accessible (for the happy-path test)
 *   - A seeded user session (standard fake-google pattern)
 *
 * Because a full backend is required for the happy-path test (S1),
 * it is marked `test.skip` — the primary safety net is the unit +
 * integration coverage from B4 (apps/api IngestModule tests).
 *
 * S2 (client-side validation) does NOT need the API, so it runs
 * in full.
 *
 * NO `pnpm build` after changes (project rule).
 */

// ---------------------------------------------------------------------------
// Helpers — same helpers used in members.spec.ts / usage.spec.ts
// ---------------------------------------------------------------------------

/** Sign in as a fresh user via the dev fake-google provider. */
async function signInFakeGoogle(
  page: import('@playwright/test').Page,
  email: string,
): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('dev-fake-google-btn').click();
  await page.getByTestId('dev-email-input').fill(email);
  await page.getByTestId('dev-sign-in-submit').click();
  await page.waitForURL('**/dashboard**');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('alerts/new — manual ingestion UI', () => {
  test(
    'S2: empty jurisdiction → inline error, Server Action NOT called',
    { tag: ['@web', '@alerts', '@manual-ingestion'] },
    async ({ page }) => {
      // Sign in so the layout (auth guard) lets us through
      const email = `alerts-new-s2-${Date.now()}@test.local`;
      await signInFakeGoogle(page, email);

      // Navigate to /alerts/new
      await page.goto('/alerts/new');
      await expect(page.getByTestId('new-alert-form')).toBeVisible();

      // Make sure we're on the URL tab
      await page.getByTestId('tab-url').click();

      // Fill a valid URL
      await page.getByTestId('input-url').fill('https://example.com/regulation.html');

      // Deliberately leave jurisdiction empty and submit
      await page.getByTestId('submit-button').click();

      // Inline error must appear
      await expect(page.getByTestId('error-jurisdiction')).toBeVisible();
      await expect(page.getByTestId('error-jurisdiction')).toContainText(
        'Jurisdiction is required',
      );

      // Server error must NOT appear (action was never called)
      await expect(page.getByTestId('server-error')).not.toBeVisible();
    },
  );

  test.skip('S1: valid URL + jurisdiction → submits and redirects to /dashboard', // The API mock approach would need MSW or a test-server setup that // NOTE: Skipped — requires apps/api + apps/scanner running.
  // is not yet configured for this project. Primary coverage: B4 unit tests.
  async ({ page }) => {
    const email = `alerts-new-s1-${Date.now()}@test.local`;
    await signInFakeGoogle(page, email);

    // Create a non-personal org so the ingest endpoint has a valid
    // orgId (same pattern as usage.spec.ts / members.spec.ts)
    await page.request.post('/api/org', {
      data: { name: 'Alerts Test Org' },
      headers: { 'Content-Type': 'application/json' },
    });

    // Refresh session so mv is up to date
    await page.goto('/dashboard');
    const refreshBtn = page.getByRole('button', { name: /refresh session/i });
    if (await refreshBtn.isVisible()) await refreshBtn.click();

    await page.goto('/alerts/new');
    await expect(page.getByTestId('new-alert-form')).toBeVisible();

    // Fill the URL tab
    await page.getByTestId('tab-url').click();
    await page.getByTestId('input-url').fill('https://www.bcra.gob.ar/Pdfs/Texord/t-runif.pdf');

    // Select jurisdiction
    await page.getByTestId('select-jurisdiction').selectOption('AR');

    // Submit
    await page.getByTestId('submit-button').click();

    // On success: redirected to /dashboard
    await page.waitForURL('**/dashboard**');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test(
    'PDF tab: oversized file → inline error, no submit',
    { tag: ['@web', '@alerts', '@manual-ingestion'] },
    async ({ page }) => {
      const email = `alerts-new-pdf-${Date.now()}@test.local`;
      await signInFakeGoogle(page, email);

      await page.goto('/alerts/new');
      await page.getByTestId('tab-pdf').click();

      // Upload a file > 10MB using a programmatic File
      const bigBuffer = Buffer.alloc(11 * 1024 * 1024, 0);
      await page.getByTestId('input-file').setInputFiles({
        name: 'big.pdf',
        mimeType: 'application/pdf',
        buffer: bigBuffer,
      });

      // Select jurisdiction
      await page.getByTestId('select-jurisdiction').selectOption('BR');

      await page.getByTestId('submit-button').click();

      await expect(page.getByTestId('error-file')).toBeVisible();
      await expect(page.getByTestId('error-file')).toContainText('PDF must be under 10MB');
    },
  );
});
