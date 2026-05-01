/**
 * Registration gate — invitation-only sign-in policy for MVP-5.
 *
 * Spec: `sdd/scanner-vertical-ar/spec` R-15-RegistrationGate
 *   (and capability/auth INV-AUTH-1 lockout-safe invariant).
 * Design: ADR-13 — env-flag + allowlist.
 * Decision: `regwatch/decisions/gemini-cost-ceiling` (#721) — public
 *   registration is CLOSED until billing-stripe ships. Owner controls cost
 *   exposure by curating `INVITED_EMAILS` manually.
 *
 * ## Allow chain (FIRST match wins; otherwise BLOCK)
 *
 *   1. `REGISTRATION_ENABLED === true`            — public sign-up open
 *   2. email present in `INVITED_EMAILS` allowlist — manually invited
 *   3. user has ≥1 existing `Membership` row      — returning user
 *      (lockout-safe: never block a user who already belongs to an org)
 *   4. user has a pending (non-accepted, non-revoked) `Invitation`
 *      addressed to this email — invitation-accept flow takes over
 *
 * Anything else → block (NextAuth `signIn` callback returns `false` →
 * NextAuth redirects to `/login?error=AccessDenied`).
 *
 * ## Why this lives in its own module
 *
 * - Keeps `auth.ts` thin (pure NextAuth wiring).
 * - Allows unit tests without standing up the entire NextAuth runtime
 *   (mirrors the `auth-memberships.ts` / `auth-signout.ts` split).
 * - The pure-function shape (`(email, deps) → boolean`) means each branch
 *   is exercised by a tiny fake-Prisma test.
 *
 * ## Foot-gun pinned
 *
 * `email` arrives from the OAuth provider / magic-link request. We
 * lowercase + trim it BEFORE every comparison so a user signing in with
 * `Bob@Example.com` matches an allowlist entry stored as
 * `bob@example.com` (the env parser already lowercases — see
 * `parseInvitedEmails`). NEVER compare raw email casing.
 */
import type { PrismaClient } from '@regwatch/db';

export interface RegistrationGateEnv {
  REGISTRATION_ENABLED: boolean;
  INVITED_EMAILS: Set<string>;
}

export interface RegistrationGateDeps {
  env: RegistrationGateEnv;
  prisma: Pick<PrismaClient, 'user' | 'invitation'>;
}

/**
 * Decide whether a sign-in attempt should proceed for `rawEmail`.
 *
 * Returns `false` (block) when ALL of:
 *   - `REGISTRATION_ENABLED === false`
 *   - email is missing OR not in allowlist
 *   - email belongs to no existing user with memberships
 *   - email has no pending invitation
 *
 * Otherwise returns `true` (allow).
 */
export async function isSignInAllowed(
  rawEmail: string | null | undefined,
  deps: RegistrationGateDeps,
): Promise<boolean> {
  // (a) Public registration open → fast path, never touches DB.
  if (deps.env.REGISTRATION_ENABLED) return true;

  const email = (rawEmail ?? '').trim().toLowerCase();
  // No email at all → block. NextAuth requires an email for both Google
  // OAuth and magic-link providers, so this is a defensive guard.
  if (!email) return false;

  // (b) Allowlist match — manual invitation by env. Single Set lookup,
  // no DB hit. Order matters: this is cheap and the most common bypass
  // for early-stage owner-curated invitations.
  if (deps.env.INVITED_EMAILS.has(email)) return true;

  // (c) Returning user with ≥1 Membership. INV-AUTH-1 / R-15 S "Existing
  // OWNER passes even when registration disabled" → never lock an
  // existing org member out.
  // Single round-trip: select only `take: 1` membership id.
  const existing = await deps.prisma.user.findUnique({
    where: { email },
    select: { memberships: { select: { id: true }, take: 1 } },
  });
  if (existing?.memberships.length) return true;

  // (d) Pending invitation by email — the user is mid-onboarding via the
  // accept flow. Letting them sign in is what makes the
  // `/invitations/[token]/accept` UX work. Filter out accepted + revoked
  // (computed status terminal) — only NULLs on both sides count as live.
  const pending = await deps.prisma.invitation.findFirst({
    where: { email, acceptedAt: null, revokedAt: null },
    select: { id: true },
  });
  if (pending) return true;

  // No bypass matched → block. NextAuth surfaces this as
  // `/login?error=AccessDenied`.
  return false;
}
