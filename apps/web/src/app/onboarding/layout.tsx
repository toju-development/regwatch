/**
 * Onboarding layout — `apps/web/src/app/onboarding/layout.tsx`.
 *
 * Minimal chrome: org logo + "Skip all" button. No dashboard nav.
 * Mounted OUTSIDE the `(dashboard)` route group so the full dashboard
 * layout (nav chrome, OrgSwitcher) never renders behind the wizard.
 *
 * "Skip all" calls `apiServerFetch` directly from a server action, which
 * PATCHes `/org/:orgId/settings` and — only on success — redirects to
 * `/dashboard`. If the PATCH fails, an error is thrown (no redirect).
 *
 * Spec: `sdd/onboarding-flow/spec` — "Dedicated /onboarding route
 *   outside dashboard group", "Skip all from layout header".
 * Design: `sdd/onboarding-flow/design` — onboarding/layout.tsx file
 *   change (Create, minimal chrome).
 *
 * NO `pnpm build` after changes (project rule).
 */
import { redirect } from 'next/navigation';
import type { MembershipClaim } from '@regwatch/types';

import { auth } from '@/lib/auth';
import { resolveActiveOrg } from '@/lib/active-org-resolve';
import { apiServerFetch } from '@/lib/api-server';

/** Skip-all form action — marks onboarding complete and redirects. */
async function skipAllAction(): Promise<never> {
  'use server';

  const session = await auth();
  if (!session?.user) redirect('/login');

  const memberships = ((session.user as unknown as { memberships?: MembershipClaim[] })
    .memberships ?? []) as ReadonlyArray<MembershipClaim>;

  const { activeOrgId } = await resolveActiveOrg(memberships);
  if (!activeOrgId) redirect('/login');

  const res = await apiServerFetch(`/org/${activeOrgId}/settings`, {
    method: 'PATCH',
    orgId: activeOrgId,
    body: { onboardingCompletedAt: new Date().toISOString() },
  });

  if (!res.ok) {
    throw new Error(`Failed to mark onboarding complete (${res.status})`);
  }

  redirect('/dashboard');
}

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b" data-testid="onboarding-header">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-4 py-3">
          <div className="font-semibold">RegWatch</div>
          <form action={skipAllAction}>
            <button
              type="submit"
              className="text-muted-foreground hover:text-foreground text-sm"
              data-testid="skip-all-button"
            >
              Skip all
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
