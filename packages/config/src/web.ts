import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';
import { createCoreEnv } from './core.js';

/**
 * Web env slice — apps/web (Next.js 15).
 *
 * Composes core + NextAuth/Resend/fake-google vars.
 * Spec: auth-foundation § config — Per-app env slices.
 * Operator decision (#624): MEMORY transport + FAKE google in dev/CI;
 *   real Resend / Google deferred to a deploy slice.
 *   Therefore AUTH_GOOGLE_*, AUTH_RESEND_KEY, AUTH_EMAIL_FROM, AUTH_URL
 *   are OPTIONAL at the schema level. Runtime enforcement lives in
 *   `apps/web/src/lib/auth.ts`:
 *     - email provider is selected from EMAIL_TRANSPORT and FAILS FAST at
 *       module load if 'resend' is set without AUTH_RESEND_KEY +
 *       AUTH_EMAIL_FROM (no silent fallback — Q4 lock);
 *     - AUTH_FAKE_GOOGLE gates the dev-only fake-google credentials
 *       provider mount.
 *
 * @param runtimeEnv override for tests; defaults to `process.env` at call time.
 */
export function createWebEnv(runtimeEnv: Record<string, string | undefined> = process.env) {
  return createEnv({
    extends: [createCoreEnv(runtimeEnv)],
    server: {
      AUTH_URL: z.string().url().optional(),
      // Server-side base URL for `apps/api` used by the proxy route handlers
      // under `apps/web/src/app/api/org/*` (PROXY MODE — see engram
      // `regwatch/decisions/org-membership-proxy-mode`). Server-only by
      // design: the JWT attachment happens server-side, so the browser
      // never needs to know this URL.
      API_URL: z.string().url(),
      AUTH_GOOGLE_ID: z.string().min(1).optional(),
      AUTH_GOOGLE_SECRET: z.string().min(1).optional(),
      AUTH_RESEND_KEY: z.string().min(1).optional(),
      AUTH_EMAIL_FROM: z.string().email().optional(),
      EMAIL_TRANSPORT: z.enum(['resend', 'memory']).default('memory'),
      AUTH_FAKE_GOOGLE: z
        .enum(['0', '1'])
        .default('0')
        .transform((v) => v === '1'),
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
    // Build-time bypass: Next.js evaluates the module graph during
    // `next build` page-data collection (e.g. `/api/auth/[...nextauth]`),
    // where real env is unavailable. Runtime (server start, Vitest,
    // Playwright, dev) does NOT set this flag → validation runs as usual.
    skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  });
}

export type WebEnv = ReturnType<typeof createWebEnv>;
