/**
 * `/settings/billing` — RSC page showing plan status and upgrade CTA.
 *
 * Spec: `sdd/billing-stripe/spec` § 5. Web Billing Page.
 * Design: `sdd/billing-stripe/design` § File Changes.
 *
 * Fetches subscription status server-side via `apiServerFetch`.
 * Missing row (null) = Free plan. OWNER can upgrade; ADMIN can view.
 *
 * sdd/billing-stripe POST-9 — Task 4.3.
 */
import { redirect } from 'next/navigation';
import type { MembershipClaim } from '@regwatch/types';
import type { SubscriptionDto } from '@regwatch/types';

import { auth } from '@/lib/auth';
import { resolveActiveOrg } from '@/lib/active-org-resolve';
import { apiServerFetch } from '@/lib/api-server';
import { BillingUpgradeButton } from './upgrade-button';

export const dynamic = 'force-dynamic';

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default async function BillingSettingsPage(): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const user = session.user as unknown as {
    id?: string;
    userId?: string;
    memberships?: MembershipClaim[];
  };
  const memberships = (user.memberships ?? []) as ReadonlyArray<MembershipClaim>;

  const { activeOrgId } = await resolveActiveOrg(memberships);
  if (activeOrgId === null) {
    redirect('/dashboard');
  }

  const viewerMembership = memberships.find((m) => m.organizationId === activeOrgId);
  const isOwner = viewerMembership?.role === 'OWNER';

  let subscription: SubscriptionDto | null = null;
  const res = await apiServerFetch('/billing/status', {
    method: 'GET',
    orgId: activeOrgId,
  });

  if (res.ok) {
    subscription = (await res.json()) as SubscriptionDto | null;
  }

  const isPro = subscription?.status === 'active' || subscription?.status === 'trialing';
  const planName = isPro ? 'Pro' : 'Free';

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8" data-testid="billing-page">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-muted-foreground text-sm">Manage your subscription and plan.</p>
      </header>

      <div className="rounded-lg border p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-muted-foreground text-sm font-medium">Current Plan</p>
            <p className="mt-1 text-xl font-semibold" data-testid="billing-plan-name">
              {planName}
            </p>
          </div>

          {subscription && (
            <div>
              <p className="text-muted-foreground text-sm font-medium">Status</p>
              <p className="mt-1 text-sm capitalize" data-testid="billing-status">
                {subscription.status.replace('_', ' ')}
              </p>
            </div>
          )}

          {subscription?.currentPeriodEnd && (
            <div>
              <p className="text-muted-foreground text-sm font-medium">
                {subscription.status === 'canceled' ? 'Access until' : 'Renews'}
              </p>
              <p className="mt-1 text-sm" data-testid="billing-renewal-date">
                {formatDate(subscription.currentPeriodEnd)}
              </p>
            </div>
          )}
        </div>

        {!isPro && isOwner && (
          <div className="mt-6 border-t pt-6">
            <p className="text-muted-foreground mb-3 text-sm">
              Upgrade to Pro to get unlimited alerts, multiple jurisdictions, and team members.
            </p>
            <BillingUpgradeButton orgId={activeOrgId} />
          </div>
        )}
      </div>
    </main>
  );
}
