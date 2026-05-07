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
