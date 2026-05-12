import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';
import { createCoreEnv } from './core.js';

/**
 * Parse the `INVITED_EMAILS` CSV env var into a normalised allowlist.
 *
 * Spec: `sdd/scanner-vertical-ar/spec` R-15-RegistrationGate / BIZ-4
 *   (`#721` invitation-only decision).
 * Design: ADR-13 — env-flag + allowlist registration block.
 *
 * Behaviour:
 *   - Empty / whitespace-only string → empty `Set` (no allowlist).
 *   - Otherwise: split on `,`, trim each entry, lowercase, drop empty
 *     fragments (tolerates trailing commas + double commas).
 *   - **Fail-fast**: every surviving entry MUST satisfy `z.string().email()`.
 *     A malformed entry throws synchronously at module load — never a
 *     silent drop, because a single typo in `INVITED_EMAILS` would
 *     otherwise lock a real invitee out without any boot-time signal.
 */
export function parseInvitedEmails(raw: string): Set<string> {
  const trimmed = raw.trim();
  if (!trimmed) return new Set<string>();

  const entries = trimmed
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const emailSchema = z.string().email();
  for (const entry of entries) {
    const parsed = emailSchema.safeParse(entry);
    if (!parsed.success) {
      throw new Error(
        `INVITED_EMAILS contains an invalid email entry: "${entry}". ` +
          'Provide a comma-separated list of valid emails (or leave empty).',
      );
    }
  }
  return new Set(entries);
}

/**
 * Web env slice — apps/web (Next.js 15).
 *
 * Composes core + NextAuth/Resend/fake-google/microsoft-entra vars.
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
 *   Microsoft Entra ID vars are individually optional but all-or-nothing:
 *     if 1 or 2 of the 3 vars are set, createWebEnv() throws at startup
 *     (spec R-ENTRA-2 / INV-ENTRA-1).
 *
 * @param runtimeEnv override for tests; defaults to `process.env` at call time.
 */
export function createWebEnv(runtimeEnv: Record<string, string | undefined> = process.env) {
  const env = createEnv({
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
      // ---- Registration block (sdd/scanner-vertical-ar B8 / BIZ-4) ----
      // Public registration is CLOSED by default in MVP-5 (#721 decision).
      // Set `REGISTRATION_ENABLED=1` to re-open public sign-ups (e.g. once
      // billing-stripe ships post-MVP-9). Boolean coerced from '0'/'1' to
      // mirror the AUTH_FAKE_GOOGLE convention — `z.coerce.boolean()`
      // would treat the string "false" as truthy, which is a foot-gun.
      REGISTRATION_ENABLED: z
        .enum(['0', '1'])
        .default('0')
        .transform((v) => v === '1'),
      // CSV allowlist used as a sign-in bypass when REGISTRATION_ENABLED=0.
      // Empty string → empty Set. Validation is fail-fast per
      // `parseInvitedEmails` (see helper above).
      INVITED_EMAILS: z
        .string()
        .default('')
        .transform((raw, ctx) => {
          // Use a `ctx.addIssue` round-trip rather than throwing inside the
          // transform — `@t3-oss/env-core` runs the parse via Zod and bubbles
          // throws as unhandled rejections (see foot-gun
          // `regwatch/footguns/zod-transform-throws-bubble-as-rejection`).
          // Surfacing the error as a Zod issue lets t3-env's
          // `onValidationError` print a clean boot-time failure.
          try {
            return parseInvitedEmails(raw);
          } catch (err) {
            ctx.addIssue({
              code: 'custom',
              message: err instanceof Error ? err.message : 'INVITED_EMAILS parse failed',
            });
            return z.NEVER;
          }
        }),
      // ---- Microsoft Entra ID (sdd/auth-ms-entra) ----
      // Three individually optional vars; all must be set together or all
      // absent. Partial config throws at startup via the all-or-nothing guard
      // below (spec R-ENTRA-2 / INV-ENTRA-1).
      AUTH_MICROSOFT_ENTRA_ID: z.string().optional(),
      AUTH_MICROSOFT_ENTRA_SECRET: z.string().optional(),
      AUTH_MICROSOFT_ENTRA_TENANT_ID: z.string().optional(),
      // Dev-only fake Entra Credentials provider — mounted when set to 'true'.
      // By convention, production deployments do not set this var (same
      // pattern as AUTH_FAKE_GOOGLE).
      AUTH_FAKE_ENTRA: z.string().optional(),
      // ---- Stripe billing (sdd/billing-stripe POST-9) ----
      // Server-only: used when the Server Action calls apps/api to create
      // a Checkout session. The price ID is needed to pass to the action.
      STRIPE_PRO_PRICE_ID: z.string().min(1),
      // Stripe publishable key — safe to expose to the browser but stored
      // here in server block for consistency (web.ts uses env-core, not
      // env-nextjs; Stripe-hosted Checkout does not require Stripe.js on
      // the client — we just redirect to the Stripe-hosted URL).
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1),
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
    // Build-time bypass: Next.js evaluates the module graph during
    // `next build` page-data collection (e.g. `/api/auth/[...nextauth]`),
    // where real env is unavailable. Runtime (server start, Vitest,
    // Playwright, dev) does NOT set this flag → validation runs as usual.
    skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  });

  // All-or-nothing Entra guard (R-ENTRA-2 / INV-ENTRA-1):
  // Partial config (1 or 2 of 3 vars set) is always a misconfiguration —
  // fail fast at startup rather than silently mounting no provider.
  // We skip this check under SKIP_ENV_VALIDATION (build-time bypass).
  if (!process.env.SKIP_ENV_VALIDATION) {
    const entraRaw = [
      runtimeEnv['AUTH_MICROSOFT_ENTRA_ID'],
      runtimeEnv['AUTH_MICROSOFT_ENTRA_SECRET'],
      runtimeEnv['AUTH_MICROSOFT_ENTRA_TENANT_ID'],
    ].filter((v) => !!v && v.length > 0); // treat empty strings as absent
    if (entraRaw.length > 0 && entraRaw.length < 3) {
      throw new Error(
        'AUTH_MICROSOFT_ENTRA_ID, AUTH_MICROSOFT_ENTRA_SECRET, and ' +
          'AUTH_MICROSOFT_ENTRA_TENANT_ID must all be set or all be absent ' +
          `(${entraRaw.length}/3 vars found)`,
      );
    }
  }

  return env;
}

export type WebEnv = ReturnType<typeof createWebEnv>;
