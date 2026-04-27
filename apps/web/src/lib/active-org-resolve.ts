/**
 * Active-org server-side resolver.
 *
 * Spec: `sdd/org-membership-ux/spec`
 *   - R-ActiveOrgCookie scenarios "Cookie absent → auto-pick first
 *     membership" and "Cookie points to revoked membership → rewrite".
 *   - R-Org-GetMe scenario "no cookie → activeOrgId === memberships[0]
 *     auto-pick" (system-level: web layer auto-picks; api echoes).
 *
 * Design: §3 + §8 + decision #4 (default-org algorithm).
 *
 * Two exports:
 *   - `pickDefault(memberships)` — pure function: personal-first, else
 *     first by JWT order. Trivially testable.
 *   - `resolveActiveOrg(memberships)` — server-only: reads the active-
 *     org cookie via `next/headers`, validates against the supplied
 *     memberships list, and returns `{ activeOrgId, memberships }`.
 *     Pure read (no cookie writes) — safe for RSC.
 *
 * Cookie-WRITE side effect (auto-pick when absent) belongs in a server
 * action / route handler — see `setActiveOrgIdCookie` and the future
 * `<ActiveOrgProvider>` mount in the dashboard layout (B5). Keeping
 * this module read-only avoids the Next 15 RSC-cannot-write-cookies
 * trap and keeps the resolver pure for unit testing.
 */
import 'server-only';

import type { MembershipClaim } from '@regwatch/types';

import { getActiveOrgIdFromCookies } from './active-org-cookie.js';

export interface ResolvedActiveOrg {
  /** The validated active org id, or `null` when memberships is empty. */
  activeOrgId: string | null;
  /** Echoes the memberships list (caller-provided; pass-through). */
  memberships: ReadonlyArray<MembershipClaim>;
}

/**
 * Default-org algorithm (decision #4): personal org first (`isPersonal`
 * derived from `MembershipClaim.role` is NOT enough — `isPersonal` lives
 * on the API response shape, NOT the JWT claim. The JWT claim only
 * carries `{organizationId, orgSlug, role}`. Therefore the WEB-layer
 * default-pick is:
 *   - First membership in JWT order (which is Prisma `findMany` order,
 *     i.e. creation order). The personal org is always created FIRST
 *     (auto-org invariant — see `auto-org.ts`), so it is naturally
 *     `memberships[0]` until the user joins/creates another org.
 *
 * If the upstream JWT shape ever grows an `isPersonal` field, switch
 * to true personal-first selection here.
 */
export function pickDefault(memberships: ReadonlyArray<MembershipClaim>): string | null {
  if (memberships.length === 0) return null;
  return memberships[0]!.organizationId;
}

/**
 * Resolve the active org for the current request.
 *
 * Algorithm:
 *   1. Read cookie via `next/headers` (null when absent).
 *   2. If the cookie value matches a membership in the supplied list →
 *      return it as-is (happy path).
 *   3. Otherwise (absent OR stale OR points to a revoked membership) →
 *      fall back to `pickDefault(memberships)`.
 *
 * Returns the resolved id; the CALLER decides whether to persist it
 * (cookie write requires a server-action / route-handler context per
 * Next 15 rules).
 */
export async function resolveActiveOrg(
  memberships: ReadonlyArray<MembershipClaim>,
): Promise<ResolvedActiveOrg> {
  const cookieValue = await getActiveOrgIdFromCookies();
  const validIds = new Set(memberships.map((m) => m.organizationId));

  const activeOrgId =
    cookieValue !== null && validIds.has(cookieValue) ? cookieValue : pickDefault(memberships);

  return { activeOrgId, memberships };
}
