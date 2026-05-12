import 'reflect-metadata';

/**
 * Vitest setup for apps/api.
 *
 * Sets the env vars required by `createApiEnv()` (via t3-env) BEFORE any
 * source module under test imports `./env.js`. Without this, importing
 * `JwtVerifier` or anything that touches `env` would throw a ZodError at
 * module evaluation time.
 *
 * Spec: `sdd/auth-foundation/spec` § config — "AUTH_SECRET in core" (≥32 chars).
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.PORT = process.env.PORT ?? '3001';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test';
process.env.AUTH_SECRET =
  process.env.AUTH_SECRET ?? 'test-auth-secret-must-be-at-least-32-chars-ok';
process.env.SCANNER_INTERNAL_SECRET =
  process.env.SCANNER_INTERNAL_SECRET ?? 'test-scanner-secret-at-least-32-chars-ok';
process.env.MANUAL_INGEST_ENABLED = process.env.MANUAL_INGEST_ENABLED ?? 'true';
// sdd/notify-email-resend (POST-2): use memory transport in all tests so
// RESEND_API_KEY / RESEND_FROM_EMAIL are not required by createApiEnv().
process.env.EMAIL_TRANSPORT = process.env.EMAIL_TRANSPORT ?? 'memory';
// sdd/billing-stripe POST-9 — required by createApiEnv
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test_placeholder';
process.env.STRIPE_PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID ?? 'price_test_placeholder';
