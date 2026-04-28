/**
 * `<ActiveOrgProvider>` — client component that bridges TWO sources of
 * truth into the Zustand `useActiveOrg` store:
 *
 *   1. RSC props (initial paint + revalidatePath('/', 'layout') re-runs).
 *   2. `useSession()` from next-auth/react (continuous reactive sync —
 *      fires after `session.update()` rotates the JWT memberships claim
 *      so any UI surface, not just the switcher, sees the refreshed
 *      data WITHOUT a page reload or manual `setMemberships` workaround).
 *
 * Spec: `sdd/org-membership-ux/spec`
 *   - § R-Switcher (drives the switcher UI).
 *   - § R-ApiFetch (the hydration gate enforced by `apiFetch`).
 *   - § R-ActiveOrgCookie (`activeOrgId` mirrors the HttpOnly cookie).
 *   - § R-Jwt-Refresh-OnSelfCreate ("any UI surface MUST see the
 *     refreshed memberships" — fulfilled by the reactive sync below).
 * Design: §4 + §6 + decision #5 ("Hybrid: RSC seeds, client mirrors").
 *
 * Foot-gun: `regwatch/footguns/active-org-provider-needs-reactive-session-sync`.
 *   The original implementation seeded ONCE from props with a one-shot
 *   `useEffect` keyed by a stable hash. After `session.update()` +
 *   `router.refresh()` the JWT claim updated and the cookie rotated,
 *   but the store stayed stale until a hard reload. `<OrgSwitcher>`
 *   silently masked the bug by manually calling `setMemberships([...])`
 *   after a self-create — a workaround that did not generalize to other
 *   surfaces (dashboard, future members/settings pages). Discovered by
 *   the B6 E2E spec exercising the out-of-band create flow
 *   (POST /api/org → session.update() → expect dashboard count to flip).
 *   Fix: continuous reactive sync from `useSession()` so the store
 *   tracks the JWT claim identity for the lifetime of the provider.
 *
 * Mount pattern (wired in `(dashboard)/layout.tsx`):
 *
 *   const session = await auth();
 *   const memberships = session.user.memberships;
 *   const { activeOrgId } = await resolveActiveOrg(memberships);
 *   return (
 *     <SessionProvider>
 *       <ActiveOrgProvider memberships={memberships} activeOrgId={activeOrgId}>
 *         {children}
 *       </ActiveOrgProvider>
 *     </SessionProvider>
 *   );
 *
 * Provider order matters: `<SessionProvider>` MUST be outer so the
 * `useSession()` call below resolves a real context.
 *
 * Hydration semantics:
 *   - Initial seed effect: keyed on a stable hash of `(memberships,
 *     activeOrgId)`. Runs on mount and any RSC re-render that yields
 *     value-different props. Calls `setMemberships` + `setActive` +
 *     `markHydrated` in one tick so React Strict Mode's double-mount
 *     in dev doesn't toggle hydrated false → true → false.
 *   - Reactive session-sync effect: keyed on a stable hash of the
 *     session memberships claim. Runs only when `status === 'authenticated'`
 *     AND the session actually carries a memberships array. This avoids
 *     blanking out the prop-seeded data during the initial `loading` →
 *     `authenticated` transition.
 *   - We deliberately do NOT sync `activeOrgId` from the session — it
 *     lives in the HttpOnly cookie, not the JWT claim. Switching writes
 *     the cookie via a server action which `revalidatePath`s and re-
 *     seeds `activeOrgId` via the prop path above.
 *   - Children render eagerly. Components that need a hydrated store
 *     should call `useActiveOrg((s) => s.hydrated)` and gate themselves
 *     — apiFetch already throws on misuse so a stale call is loud.
 */
'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import type { MembershipClaim } from '@regwatch/types';

import { useActiveOrg } from '@/lib/active-org-store';
import { registerSessionUpdater } from '@/lib/session-update';

export interface ActiveOrgProviderProps {
  memberships: ReadonlyArray<MembershipClaim>;
  activeOrgId: string | null;
  children: React.ReactNode;
}

/**
 * Stable identity hash for a memberships list. Used as a `useEffect`
 * dependency so the effect only re-fires on actual data change, not on
 * fresh array refs from re-renders. Includes `role` and `orgSlug` so a
 * role change or slug change (rare but possible) also triggers a sync.
 */
function membershipsHash(list: ReadonlyArray<MembershipClaim>): string {
  return list.map((m) => `${m.organizationId}:${m.role}:${m.orgSlug}`).join('|');
}

export function ActiveOrgProvider({
  memberships,
  activeOrgId,
  children,
}: ActiveOrgProviderProps): React.ReactElement {
  const setMemberships = useActiveOrg((s) => s.setMemberships);
  const setActive = useActiveOrg((s) => s.setActive);
  const markHydrated = useActiveOrg((s) => s.markHydrated);

  // ── Initial seed from RSC props (mount + any revalidatePath() pass
  //    that re-renders the provider with new props). The composite key
  //    keeps the effect from re-firing on every render when the parent
  //    passes a freshly-allocated (but value-equal) array.
  const seedKey = `${membershipsHash(memberships)}::${activeOrgId ?? ''}`;

  useEffect(() => {
    setMemberships(memberships);
    setActive(activeOrgId);
    markHydrated();
    // seedKey is the composite data identity; the setters are stable
    // Zustand action refs and intentionally omitted.
  }, [seedKey]);

  // ── Reactive sync from `useSession()` — fires after `session.update()`
  //    rotates the JWT memberships claim. This is the mechanism that
  //    lets ANY UI surface (dashboard, future members page, settings)
  //    observe a self-create / accept-invite without a page reload.
  const { data: sessionData, status, update } = useSession();
  const sessionMemberships =
    (sessionData?.user as { memberships?: MembershipClaim[] } | undefined)?.memberships ?? null;
  const sessionMembershipsKey =
    sessionMemberships !== null ? membershipsHash(sessionMemberships) : null;

  useEffect(() => {
    // Skip during the initial loading phase so we don't blank out the
    // prop-seeded memberships before the session resolves.
    if (status !== 'authenticated') return;
    if (sessionMemberships === null) return;
    setMemberships(sessionMemberships);
    // sessionMembershipsKey + status are the data inputs; setMemberships
    // is a stable Zustand action ref; sessionMemberships is read inside
    // and tracked via its hash key.
  }, [status, sessionMembershipsKey]);

  // ── Bridge `useSession().update` into the module-level
  //    `triggerSessionUpdate()` registry consumed by `apiFetch` (lib/
  //    session-update.ts). Required by spec
  //    `sdd/org-members/spec` § R-Jwt-Invalidate-Cross-User: when the
  //    API responds 401 STALE_MEMBERSHIPS, `apiFetch` MUST re-mint the
  //    JWT via `update({})` (foot-gun #670 — empty object MANDATORY)
  //    before retrying. `update` is only available from the React hook
  //    so we register here once it's stable.
  //
  //    `update` is intentionally the only dep: NextAuth re-creates it on
  //    re-render, but registering the latest reference is harmless and
  //    cheap (single ref assignment).
  useEffect(() => {
    registerSessionUpdater(update);
    return () => {
      registerSessionUpdater(null);
    };
  }, [update]);

  return <>{children}</>;
}
