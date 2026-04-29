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
        // Server-side base URL used by /api/org/* PROXY route handlers
        // (PROXY MODE — see engram regwatch/decisions/org-membership-proxy-mode).
        API_URL: `http://localhost:${API_PORT}`,
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
        // Disable the membership-freshness cache for E2E. The cache keys
        // on `(userId, jwtIat)` and amortizes the live-mv DB read for
        // 30s by default — fine in production where cross-user
        // invalidation is eventually consistent, but it makes the
        // R-Jwt-Invalidate-Cross-User silent-retry path
        // (`apps/web/e2e/members.spec.ts`) non-deterministic: Tab A's
        // PATCH bumps Tab B's `User.membershipsVersion`, but Tab B's
        // cache entry still serves the pre-bump value so no STALE
        // 401 fires on Tab B's next /api/org/me. TTL=0 means every
        // request hits the DB fresh.
        // Foot-gun: `regwatch/footguns/freshness-cache-blocks-cross-user-stale-in-e2e`.
        MEMBERSHIPS_FRESHNESS_TTL_MS: '0',
        // Mount the dev-only `TestInboxController` (`/test/email-inbox`)
        // and pin the in-memory transport. Spec
        // `sdd/org-invitations/spec` § R-Email-Port-Hexagonal — Playwright
        // (`e2e/invitations.spec.ts`) reads sent invitation emails via
        // this endpoint to harvest the accept token. The controller is
        // double-guarded (NODE_ENV !== production AND EMAIL_TRANSPORT ===
        // memory); both guards are satisfied here. Production unaffected.
        EMAIL_TRANSPORT: 'memory',
        // Base origin embedded in every invitation `acceptUrl`. Aligns
        // the link the test inbox returns with the Playwright `baseURL`
        // so `page.goto(acceptUrl)` lands on the correct dev server.
        WEB_URL: baseURL,
      },
    },
  ],
});
