/**
 * `<ActiveOrgProvider>` — client component that seeds the Zustand
 * `useActiveOrg` store from RSC props on mount.
 *
 * Spec: `sdd/org-membership-ux/spec` § R-Switcher (drives the switcher
 *   state), § R-ApiFetch (the hydration gate enforced by `apiFetch`),
 *   § R-ActiveOrgCookie (the `activeOrgId` mirrors the HttpOnly cookie).
 * Design: §4 + §6 + decision #5 ("Hybrid: RSC seeds, client mirrors").
 *
 * Mount pattern (B5 will wire this into `(dashboard)/layout.tsx`):
 *
 *   const session = await auth();
 *   const memberships = session.user.memberships;
 *   const { activeOrgId } = await resolveActiveOrg(memberships);
 *   return (
 *     <ActiveOrgProvider memberships={memberships} activeOrgId={activeOrgId}>
 *       {children}
 *     </ActiveOrgProvider>
 *   );
 *
 * Hydration semantics:
 *   - Seeds `setMemberships` + `setActive` + `markHydrated()` in a
 *     single `useEffect` so React Strict Mode's double-mount in dev
 *     does NOT toggle hydrated false → true → false (would break the
 *     `apiFetch` gate). The store's `markHydrated` is idempotent.
 *   - Re-runs when props change (e.g. after a server action +
 *     `revalidatePath('/', 'layout')`). The `JSON.stringify` of
 *     memberships keeps the dependency array stable across identical
 *     RSC renders that yield new array refs.
 *   - Children render eagerly. Components that need a hydrated store
 *     should call `useActiveOrg((s) => s.hydrated)` and gate themselves
 *     — apiFetch already throws on misuse so a stale call is loud.
 */
'use client';

import { useEffect } from 'react';
import type { MembershipClaim } from '@regwatch/types';

import { useActiveOrg } from '@/lib/active-org-store';

export interface ActiveOrgProviderProps {
  memberships: ReadonlyArray<MembershipClaim>;
  activeOrgId: string | null;
  children: React.ReactNode;
}

export function ActiveOrgProvider({
  memberships,
  activeOrgId,
  children,
}: ActiveOrgProviderProps): React.ReactElement {
  const setMemberships = useActiveOrg((s) => s.setMemberships);
  const setActive = useActiveOrg((s) => s.setActive);
  const markHydrated = useActiveOrg((s) => s.markHydrated);

  // Stringified key keeps the effect from re-firing on every render
  // when the parent passes a freshly-allocated (but value-equal) array.
  const membershipsKey = memberships.map((m) => m.organizationId).join(',');

  useEffect(() => {
    setMemberships(memberships);
    setActive(activeOrgId);
    markHydrated();
    // membershipsKey + activeOrgId are the actual data inputs; the
    // setters are stable Zustand action refs and intentionally omitted
    // from the dependency array.
  }, [membershipsKey, activeOrgId]);

  return <>{children}</>;
}
