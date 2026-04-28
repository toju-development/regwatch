/**
 * `<DashboardClient>` — the interactive surface mounted at `/dashboard`.
 *
 * Spec: `sdd/org-membership-ux/spec`
 *   - § R-ApiFetch S1 (the wrapper attaches `X-Org-Id` from the hydrated
 *     store) — this component is the canonical caller used by E2E to
 *     prove header propagation end-to-end.
 *   - § R-Jwt-Refresh-OnSelfCreate ("client MUST call session.update()
 *     after a self-create so the JWT memberships claim is refreshed").
 *   - § R-Switcher S "Sign-out clears active-org cookie" (the sign-out
 *     button here drives the cookie-clear path verified in B5 unit
 *     tests + B6 E2E).
 *
 * Design: §4 (switcher hydration) + §6 (apiFetch hydration gate) + §B6
 *   ("dashboard surface MUST expose a deterministic apiFetch trigger
 *   so E2E can capture the X-Org-Id header on the wire").
 *
 * Why this exists (and is not part of `<OrgSwitcher>`):
 *   - The switcher is a pure dropdown UI — adding network calls there
 *     would couple presentation to data fetching. Keep responsibilities
 *     split: switcher mutates active org; this component CONSUMES it.
 *   - E2E needs a deterministic place to:
 *       (a) trigger `session.update()` after creating an org via the
 *           direct `POST /api/org` path (the user prompt for B6
 *           explicitly asks for the programmatic create + refresh
 *           path, NOT the dropdown create flow which is unreachable
 *           from the 1-membership disabled state — see foot-gun
 *           `regwatch/footguns/org-switcher-1-membership-create-gap`).
 *       (b) observe an outgoing `apiFetch('/api/org/me')` request so
 *           Playwright can assert `X-Org-Id` matches the active org.
 *
 * Hydration semantics:
 *   - Reads `activeOrgId` + `hydrated` from `useActiveOrg`. The effect
 *     that fires `apiFetch('/api/org/me')` is gated on `hydrated` so it
 *     never throws `ApiFetchHydrationError`.
 *   - The fetch result is stored locally — we DO NOT push it back into
 *     Zustand because `/api/org/me` is the source of truth ONLY for
 *     the api-side scope check; the JWT remains authoritative for
 *     memberships in the UI.
 */
'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';

import { Button } from '@/components/ui/button';
import { useActiveOrg } from '@/lib/active-org-store';
import { apiFetch } from '@/lib/api-fetch';

interface OrgMeBody {
  organizationId: string;
  role: string;
  orgSlug: string;
}

export function DashboardClient(): React.ReactElement {
  const memberships = useActiveOrg((s) => s.memberships);
  const activeOrgId = useActiveOrg((s) => s.activeOrgId);
  const hydrated = useActiveOrg((s) => s.hydrated);

  const session = useSession();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [me, setMe] = useState<OrgMeBody | null>(null);
  const [meError, setMeError] = useState<string | null>(null);

  // Fire `/api/org/me` whenever the active org changes (and after
  // hydration). Each call carries `X-Org-Id` from the store via apiFetch
  // — that header on the wire is what the E2E spec asserts.
  useEffect(() => {
    if (!hydrated || activeOrgId === null) {
      setMe(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch('/api/org/me');
        if (cancelled) return;
        if (!res.ok) {
          setMeError(`me failed (${res.status})`);
          setMe(null);
          return;
        }
        const body = (await res.json()) as OrgMeBody;
        setMe(body);
        setMeError(null);
      } catch (err) {
        if (cancelled) return;
        setMeError(err instanceof Error ? err.message : String(err));
        setMe(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, activeOrgId]);

  // "Refresh session" — drives the R-Jwt-Refresh-OnSelfCreate flow when
  // the user has provisioned an org out-of-band (e.g. via direct API
  // call from E2E, or in the future via an invite-acceptance link).
  // Calls `session.update()` to re-issue the JWT with fresh memberships,
  // then `router.refresh()` to re-run the RSC layout so the provider
  // re-seeds the store. Wrapped in `startTransition` so React batches
  // the suspense correctly.
  function handleRefresh(): void {
    startTransition(async () => {
      // Two foot-guns interact here — both must be respected:
      //
      // 1. `regwatch/footguns/nextauth-v5-update-no-args-skips-post`
      //    `update()` with no args is a GET-only refetch and does NOT
      //    trigger `jwt({ trigger: 'update' })`. Pass any non-undefined
      //    arg (`{}`) so next-auth POSTs `/api/auth/session` and the
      //    jwt callback re-fetches memberships from the DB.
      //
      // 2. `regwatch/footguns/nextauth-v5-sessionprovider-needs-server-session-prop`
      //    Even with arg, `update()` bails at `if (loading) return` when
      //    `<SessionProvider>` is mounted without `session={...}` because
      //    `loading` initializes `true` (next-auth react.tsx line 406).
      //    Fix lives in `(dashboard)/layout.tsx` — `<SessionProvider session={session}>`.
      await session.update?.({});
      router.refresh();
    });
  }

  // Sign-out drives the events.signOut handler in `auth.ts` which also
  // calls `clearActiveOrgIdCookie()` — verified in B5 unit tests; the
  // cookie absence post-signOut is verified in the B6 E2E spec.
  function handleSignOut(): void {
    void signOut({ callbackUrl: '/login' });
  }

  return (
    <section
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8"
      data-testid="dashboard-section"
    >
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Hydrated</dt>
        <dd data-testid="dashboard-hydrated">{hydrated ? 'yes' : 'no'}</dd>

        <dt className="text-muted-foreground">Active org</dt>
        <dd data-testid="dashboard-active-org">{activeOrgId ?? 'none'}</dd>

        <dt className="text-muted-foreground">Memberships</dt>
        <dd data-testid="dashboard-membership-count">{memberships.length}</dd>

        <dt className="text-muted-foreground">/api/org/me</dt>
        <dd data-testid="dashboard-me">
          {meError ? `error: ${meError}` : me ? me.orgSlug : 'pending…'}
        </dd>
      </dl>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleRefresh}
          disabled={pending}
          data-testid="dashboard-refresh-session"
        >
          Refresh session
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={handleSignOut}
          data-testid="dashboard-signout"
        >
          Sign out
        </Button>
      </div>
    </section>
  );
}
