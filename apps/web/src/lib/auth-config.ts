/**
 * `buildProviders()` — pure helper for NextAuth provider array construction.
 *
 * Spec: sdd/auth-ms-entra R-ENTRA-1 (conditional Entra ID registration),
 *   R-ENTRA-6 (existing flows not broken).
 * Design: sdd/auth-ms-entra § Interfaces / Contracts.
 *
 * Extracted from `auth.ts` so the conditional logic is unit-testable without
 * pulling in `server-only`, PrismaAdapter, or the JWT encode/decode override.
 *
 * Rules:
 *   - NO `import 'server-only'` — intentional, required for testability.
 *   - NO PrismaAdapter / @regwatch/db import.
 *   - Google and email providers remain in `auth.ts` (edge-safe slice +
 *     resolveEmailProvider). This helper adds the conditional/optional
 *     credential providers only.
 */
import type { WebEnv } from '@regwatch/config/web';
import MicrosoftEntraId from 'next-auth/providers/microsoft-entra-id';

import { fakeGoogleProvider } from '@/lib/auth-providers/fake-google';
import { fakeEntraProvider } from '@/lib/auth-providers/fake-entra';

/**
 * Build the conditional / optional NextAuth providers array from the parsed
 * web config. Called in `auth.ts` and spread into the final `providers[]`.
 *
 * The Google OAuth and email (Resend / memory) providers live in `auth.ts`
 * because Google comes from the edge-safe `authConfig` slice and email
 * requires the `resolveEmailProvider()` transport-switch logic.
 *
 * Provider inclusion rules:
 *   - `fakeGoogleProvider` — when `cfg.AUTH_FAKE_GOOGLE === true`
 *   - `MicrosoftEntraId`   — when all three Entra vars are present
 *   - `fakeEntraProvider`  — when `cfg.AUTH_FAKE_ENTRA === 'true'`
 */
export function buildProviders(cfg: WebEnv) {
  // All three vars must be truthy for the real Entra provider to mount.
  // The Zod all-or-nothing guard in createWebEnv() already rejects partial
  // configs, so this check is purely a runtime guard for type narrowing.
  const entraEnabled =
    cfg.AUTH_MICROSOFT_ENTRA_ID !== undefined &&
    cfg.AUTH_MICROSOFT_ENTRA_SECRET !== undefined &&
    cfg.AUTH_MICROSOFT_ENTRA_TENANT_ID !== undefined;

  return [
    // Dev-only fake Google Credentials provider (operator decision #624).
    // AUTH_FAKE_GOOGLE is a boolean (transformed from '0'/'1' by Zod).
    ...(cfg.AUTH_FAKE_GOOGLE ? [fakeGoogleProvider()] : []),

    // Microsoft Entra ID — conditionally included when all 3 vars are set.
    // Spec: R-ENTRA-1 / INV-ENTRA-1.
    ...(entraEnabled
      ? [
          MicrosoftEntraId({
            clientId: cfg.AUTH_MICROSOFT_ENTRA_ID!,
            clientSecret: cfg.AUTH_MICROSOFT_ENTRA_SECRET!,
            // Construct the OIDC issuer URL from the tenant ID.
            // 'common' (default) → allows personal + org accounts.
            // A specific GUID → restricts to a single Azure AD directory.
            issuer: `https://login.microsoftonline.com/${cfg.AUTH_MICROSOFT_ENTRA_TENANT_ID!}/v2.0/`,
          }),
        ]
      : []),

    // Dev-only fake Entra Credentials provider — same pattern as fakeGoogle.
    // Set AUTH_FAKE_ENTRA=true in dev/CI to enable. Production deployments
    // must NOT set this var (convention, not enforced at schema level).
    ...(cfg.AUTH_FAKE_ENTRA === 'true' ? [fakeEntraProvider()] : []),
  ];
}
