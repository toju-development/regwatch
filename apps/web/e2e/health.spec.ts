import { test, expect } from '@playwright/test';

/**
 * Bootstrap smoke test — proves the Next.js app boots and serves a UI.
 *
 * Originally targeted `/` + `bootstrap-smoke-button`. After MVP-3b1
 * (`auth-authorization-guards` B7) the edge middleware is default-secure:
 * any non-allowlisted route — including `/` — redirects unauthenticated
 * visitors to `/login`. The smoke intent ("app boots, renders a page")
 * is preserved by asserting the public `/login` page renders the magic
 * link submit button.
 */
test.describe('bootstrap health', () => {
  test(
    'login page renders (app boots, public route reachable)',
    { tag: ['@critical', '@e2e', '@bootstrap'] },
    async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByTestId('magic-link-submit')).toBeVisible();
    },
  );
});
