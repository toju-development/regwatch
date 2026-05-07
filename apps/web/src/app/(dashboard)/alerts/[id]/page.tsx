/**
 * `/alerts/[id]` — Alert detail RSC shell.
 *
 * Spec: sdd/alert-collaboration/spec — web-alerts domain.
 * Design: RSC shell fetches initial data via apiServerFetch; delegates
 *   interactive parts to <AlertDetailClient>.
 *
 * Auth: reads activeOrgId from the active-org cookie (same mechanism as
 * the layout's resolveActiveOrg). apiServerFetch attaches the session JWT.
 *
 * Handles 404 gracefully with a user-facing message.
 *
 * NO `pnpm build` after changes (project rule).
 */
import { notFound } from 'next/navigation';
import type { MembershipClaim } from '@regwatch/types';

import { auth } from '@/lib/auth';
import { resolveActiveOrg } from '@/lib/active-org-resolve';
import { apiServerFetch } from '@/lib/api-server';
import { AlertDetailClient } from './alert-detail-client';

interface AlertDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function AlertDetailPage({
  params,
}: AlertDetailPageProps): Promise<React.ReactElement> {
  const { id } = await params;

  // Resolve active org (mirrors layout.tsx pattern).
  const session = await auth();
  const memberships = ((session?.user as unknown as { memberships?: MembershipClaim[] })
    ?.memberships ?? []) as ReadonlyArray<MembershipClaim>;
  const { activeOrgId } = await resolveActiveOrg(memberships);

  let alertData: unknown = null;
  if (activeOrgId) {
    const res = await apiServerFetch(`/alerts/${encodeURIComponent(id)}`, {
      method: 'GET',
      orgId: activeOrgId,
    });

    if (res.status === 404) {
      notFound();
    }

    if (res.ok) {
      alertData = (await res.json()) as unknown;
    }
  }

  if (!alertData) {
    notFound();
  }

  return <AlertDetailClient alertId={id} initialData={alertData} />;
}
