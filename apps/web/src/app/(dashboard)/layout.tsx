/**
 * Dashboard route-group layout — `apps/web/src/app/(dashboard)/layout.tsx`.
 *
 * Spec: `sdd/org-membership-ux/spec`
 *   - § R-Switcher ("renders an org switcher in the dashboard header on
 *     every authenticated page").
 *   - § R-ActiveOrgCookie scenarios "Cookie absent → auto-pick first
 *     membership" and "Cookie points to revoked membership" (we resolve
 *     the active org server-side via `resolveActiveOrg` and seed the
 *     client store from the result).
 *   - § R-ApiFetch ("active org source: hydrated client state") — the
 *     `<ActiveOrgProvider>` mount here IS the hydration source.
 *
 * Design: `sdd/org-membership-ux/design`
 *   - §1 architecture map ("(dashboard)/layout.tsx mounts provider +
 *     switcher").
 *   - §3 cookie lifecycle ("RSC layout calls `resolveActiveOrg` …
 *     cookie WRITE for auto-pick lives in a server action").
 *   - §4 switcher hydration ("RSC seeds, client mirrors").
 *   - §6 hydration gate (apiFetch reads `useActiveOrg.getState()`).
 *   - §B5 batch detail (this file).
 *
 * Mount semantics (RSC):
 *   1. `auth()` → resolve session. Unauthenticated → `redirect('/login')`
 *      (Next 15 throws inside `redirect`; control flow stops).
 *   2. Read JWT memberships claim from `session.user.memberships`.
 *   3. Call `resolveActiveOrg(memberships)` — pure read of the active-
 *      org cookie + fallback to `pickDefault()` when cookie is absent
 *      or stale. NO cookie write here (RSC cannot write cookies in
 *      Next 15; the write happens via the `switchActiveOrg` server
 *      action when the user explicitly switches, OR on the first
 *      explicit selection in the switcher dropdown).
 *   4. Wrap children in `<SessionProvider>` (next-auth/react) so
 *      `<OrgSwitcher>` (and any future client component) can call
 *      `useSession()` / `session.update()` after self-create. This
 *      provider is a Client Component — importing it into an RSC is
 *      allowed; the boundary is automatic.
 *   5. Wrap in `<ActiveOrgProvider>` — seeds the Zustand store with
 *      memberships + activeOrgId AND flips `hydrated=true`. From this
 *      point on, `apiFetch` will accept calls (it throws
 *      `ApiFetchHydrationError` until `hydrated`).
 *   6. Render the chrome: header with `<OrgSwitcher>` mounted on the
 *      right.
 *
 * Provider order (outer → inner):
 *   <SessionProvider> → <ActiveOrgProvider> → children
 *
 * Rationale: ActiveOrgProvider does NOT call `useSession()` today, but
 * future hydration logic (e.g. cross-tab session refresh) may; nesting
 * Session outer keeps that door open without a refactor.
 *
 * Auto-pick cookie persistence:
 *   When `cookieValue !== activeOrgId` (auto-pick path) we DELIBERATELY
 *   do NOT trigger a server action from the layout to persist the
 *   cookie. Reasons:
 *     (a) Triggering side-effects from RSC render is an anti-pattern in
 *         React/Next — would re-fire on every render.
 *     (b) The next explicit user action (switch, create, signOut) will
 *         either write the correct cookie (switch / create) or clear it
 *         (signOut). The transient mismatch is harmless because
 *         `apiFetch` reads from the store (mirrors `activeOrgId`), not
 *         the cookie. Server-side reads ALWAYS go through
 *         `resolveActiveOrg` which falls back to `pickDefault` — same
 *         result either way.
 *     (c) If MVP-4+ needs a persisted-on-mount cookie, add an explicit
 *         `<EnsureActiveOrgCookie>` Client Component that fires a
 *         one-shot server action on mount. Out of scope for B5.
 *
 * NO `pnpm build` after changes (project rule).
 */
import { redirect } from 'next/navigation';
import { SessionProvider } from 'next-auth/react';
import type { MembershipClaim } from '@regwatch/types';

import { auth } from '@/lib/auth';
import { resolveActiveOrg } from '@/lib/active-org-resolve';
import { apiServerFetch } from '@/lib/api-server';
import { ActiveOrgProvider } from '@/components/org-switcher/active-org-provider';
import { OrgSwitcher } from '@/components/org-switcher/org-switcher';
import { NavLinks } from '@/components/dashboard/nav-links';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  // The `session` callback in `auth.ts` augments `session.user` with a
  // `memberships: MembershipClaim[]` field (see auth.ts:160). Cast at the
  // boundary because NextAuth's default `User` type doesn't know about it.
  const memberships = ((session.user as unknown as { memberships?: MembershipClaim[] })
    .memberships ?? []) as ReadonlyArray<MembershipClaim>;

  const { activeOrgId } = await resolveActiveOrg(memberships);

  // Onboarding redirect guard (MVP-11):
  // OWNER with null onboardingCompletedAt → redirect to /onboarding.
  // Non-OWNER roles are never redirected (ADMIN/ANALYST/VIEWER bypass).
  const activeMembership = memberships.find((m) => m.organizationId === activeOrgId);
  if (activeMembership?.role === 'OWNER' && activeOrgId) {
    const settingsRes = await apiServerFetch(`/org/${activeOrgId}/settings`, {
      method: 'GET',
      orgId: activeOrgId,
    });
    if (settingsRes.ok) {
      const body = (await settingsRes.json()) as {
        settings: { onboardingCompletedAt: string | null };
      };
      if (body.settings.onboardingCompletedAt === null) {
        redirect('/onboarding');
      }
    }
  }

  return (
    <SessionProvider session={session}>
      <ActiveOrgProvider memberships={memberships} activeOrgId={activeOrgId}>
        <div className="flex min-h-screen flex-col">
          <header className="border-b" data-testid="dashboard-header">
            <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
              <div className="font-semibold">RegWatch</div>
              <NavLinks />
              <OrgSwitcher />
            </div>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </ActiveOrgProvider>
    </SessionProvider>
  );
}
