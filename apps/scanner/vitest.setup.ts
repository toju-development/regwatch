import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Vitest setup for apps/scanner.
 *
 * Sets the env vars required by `createApiEnv()` (via t3-env) BEFORE any
 * source module under test imports `./env.js`. Mirrors `apps/api/vitest.setup.ts`.
 *
 * Also loads `apps/scanner/.env` values (if the file exists) so integration
 * tests that require a real DATABASE_URL pick up the local dev credentials.
 * Process-level env vars already set (e.g. from CI or explicit export) always
 * take priority — the .env values are only used as fallbacks.
 *
 * Spec: `sdd/auth-foundation/spec` § config — "AUTH_SECRET in core" (≥32 chars).
 */

// ── Load .env file (fallback only — never overrides process env) ──────────────
try {
  const envPath = resolve(import.meta.dirname, '.env');
  const raw = readFileSync(envPath, 'utf-8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    // Only set if not already in process env (preserve CI overrides).
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
} catch {
  // .env file absent — fine in CI where env vars are set directly.
}

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.PORT = process.env.PORT ?? '3002';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test';
process.env.AUTH_SECRET =
  process.env.AUTH_SECRET ?? 'test-auth-secret-must-be-at-least-32-chars-ok';
process.env.SCANNER_INTERNAL_SECRET = process.env.SCANNER_INTERNAL_SECRET ?? 'test-internal-secret';
// sdd/billing-stripe POST-9 — required by createApiEnv
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test_placeholder';
process.env.STRIPE_PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID ?? 'price_test_placeholder';
