/**
 * Active-org client-side store (Zustand 5).
 *
 * Spec: `sdd/org-membership-ux/spec` § R-Switcher (drives switcher UI),
 *   § R-ApiFetch (drives the `X-Org-Id` header), § R-ActiveOrgCookie
 *   (mirrors the server-side cookie value into the client).
 *
 * Design: §4 + §6 + decision #5 ("Hybrid: RSC seeds, client mirrors").
 *   - RSC `<ActiveOrgProvider memberships activeOrgId>` seeds the store.
 *   - Client `apiFetch` reads `activeOrgId` via `useActiveOrg.getState()`.
 *   - Switcher selection mutates the store + POSTs to a server action
 *     that writes the HttpOnly cookie + `revalidatePath('/', 'layout')`.
 *
 * IMPORTANT — store provenance:
 *   - The orchestrator's B3 plan called for "vanilla store" so
 *     `useActiveOrg.getState()` works outside React. Zustand 5's
 *     `create()` already exposes `getState`/`setState`/`subscribe`
 *     directly on the hook (the hook IS the store handle). No need
 *     for `createStore` from `zustand/vanilla` — that would break
 *     React subscribers.
 *
 * IMPORTANT — hydration semantics:
 *   - Initial state has `hydrated: false` and `activeOrgId: null` so
 *     `apiFetch` can reject calls fired before the provider mounts
 *     (see `api-fetch.ts` hydration gate).
 *   - `<ActiveOrgProvider>` (B4) calls `setMemberships(...)`,
 *     `setActive(...)`, then `markHydrated()` in a single mount effect.
 */
'use client';

import { create } from 'zustand';
import type { MembershipClaim } from '@regwatch/types';

export interface ActiveOrgState {
  /** The user's full memberships list (mirrored from the JWT claim). */
  memberships: ReadonlyArray<MembershipClaim>;
  /** The currently-active org id (mirrored from the HttpOnly cookie). */
  activeOrgId: string | null;
  /**
   * Whether `<ActiveOrgProvider>` has finished seeding the store from
   * RSC props. `apiFetch` MUST refuse non-public calls until true —
   * the cookie cannot be read from client JS, so the seed is the only
   * source of truth client-side.
   */
  hydrated: boolean;

  /** Replace the memberships list (RSC seed + post-create refresh). */
  setMemberships(memberships: ReadonlyArray<MembershipClaim>): void;
  /** Set the active org (switcher selection or RSC seed). */
  setActive(orgId: string | null): void;
  /** Mark the store as hydrated. Called once by `<ActiveOrgProvider>`. */
  markHydrated(): void;
  /** Test-only: reset the store between specs. */
  reset(): void;
}

const INITIAL_STATE = {
  memberships: [] as ReadonlyArray<MembershipClaim>,
  activeOrgId: null as string | null,
  hydrated: false,
};

export const useActiveOrg = create<ActiveOrgState>((set) => ({
  ...INITIAL_STATE,
  setMemberships: (memberships) => set({ memberships }),
  setActive: (activeOrgId) => set({ activeOrgId }),
  markHydrated: () => set({ hydrated: true }),
  reset: () => set({ ...INITIAL_STATE }),
}));
