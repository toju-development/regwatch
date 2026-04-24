import { test, expect } from '@playwright/test';

test.describe('bootstrap health', () => {
  test(
    'root page renders shadcn smoke button',
    { tag: ['@critical', '@e2e', '@bootstrap'] },
    async ({ page }) => {
      await page.goto('/');
      await expect(page.getByTestId('bootstrap-smoke-button')).toBeVisible();
    },
  );
});
