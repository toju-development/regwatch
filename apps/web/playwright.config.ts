import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 3000;
const API_PORT = 3001;
const baseURL = `http://localhost:${WEB_PORT}`;

/**
 * E2E config — spawns BOTH apps/web (port 3000) and apps/api (port 3001).
 *
 * Spec: `sdd/auth-foundation/spec` § auth — Magic Link Sign-in + Protected
 * API Route. Tests in `e2e/auth.spec.ts` need the api running so the
 * `_test/me` canary endpoint can verify Bearer tokens minted by web.
 *
 * Both servers MUST share `AUTH_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE` so
 * the HS256 JWS produced by web verifies on api.
 */

const SHARED_AUTH = {
  AUTH_SECRET: 'e2e-auth-secret-must-be-at-least-32-chars-ok',
  JWT_ISSUER: 'regwatch-web',
  JWT_AUDIENCE: 'regwatch-api',
  // Default points at the local dev DB (`packages/db/.env`). CI overrides via env.
  DATABASE_URL:
    process.env.DATABASE_URL ??
    'postgresql://postgres:root@localhost:5432/regwatch_dev?schema=public',
} as const;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // apps/web — Next.js dev server.
      command: 'pnpm dev',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        ...SHARED_AUTH,
        NODE_ENV: 'development',
        EMAIL_TRANSPORT: 'memory',
        AUTH_FAKE_GOOGLE: '1',
        NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}`,
      },
    },
    {
      // apps/api — NestJS via tsx. TestOnlyModule is mounted because NODE_ENV != 'production'.
      command: 'pnpm --filter @regwatch/api dev',
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
      cwd: '../..',
      env: {
        ...SHARED_AUTH,
        NODE_ENV: 'development',
        PORT: String(API_PORT),
      },
    },
  ],
});
