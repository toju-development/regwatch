/**
 * `/dashboard` — RSC page.
 *
 * Spec: sdd/dashboard-mvp/spec — web/dashboard domain.
 * Design: sdd/dashboard-mvp/design — parallel Promise.all for stats + recent + assigned.
 *
 * Fetches three data streams in parallel via apiServerFetch, renders
 * RSC dashboard components, then mounts <DashboardClient> for the
 * interactive island (session refresh + signout + E2E testids).
 *
 * Stats fetch failure → passes error prop to AlertStatsCards (visible banner).
 *
 * NO `pnpm build` after changes (project rule).
 */
import type { MembershipClaim, CursorPage, AlertStatus, Role } from '@regwatch/types';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { resolveActiveOrg } from '@/lib/active-org-resolve';
import { apiServerFetch } from '@/lib/api-server';
import { DashboardClient } from './dashboard-client';
import { AlertStatsCards } from '@/components/dashboard/alert-stats-cards';
import type { AlertStatsDto } from '@/components/dashboard/alert-stats-cards';
import { RecentAlertsList } from '@/components/dashboard/recent-alerts-list';
import type { AlertListItem } from '@/components/dashboard/recent-alerts-list';
import { AssignedToMeList } from '@/components/dashboard/assigned-to-me-list';

export default async function DashboardPage(): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const memberships = ((session.user as unknown as { memberships?: MembershipClaim[] })
    .memberships ?? []) as ReadonlyArray<MembershipClaim>;

  const userId = (session.user as unknown as { userId?: string }).userId ?? '';

  const { activeOrgId } = await resolveActiveOrg(memberships);

  // Determine role for current org — used to control AssignedToMeList visibility
  const activeMembership = memberships.find((m) => m.organizationId === activeOrgId);
  const role: Role = activeMembership?.role ?? 'VIEWER';

  // Parallel fetch: stats + recent alerts + assigned-to-me (skip assigned fetch when userId unknown)
  const orgFetchInit = activeOrgId ? { orgId: activeOrgId } : {};
  const [statsRes, recentRes, assignedRes] = await Promise.all([
    apiServerFetch('/alerts/stats', { method: 'GET', ...orgFetchInit }),
    apiServerFetch('/alerts?limit=10', { method: 'GET', ...orgFetchInit }),
    userId
      ? apiServerFetch(`/alerts?assigneeId=${userId}&limit=5`, { method: 'GET', ...orgFetchInit })
      : Promise.resolve(null),
  ]);

  // Stats — error → pass null (triggers visible error banner)
  let stats: AlertStatsDto | null = null;
  let statsError = false;
  if (statsRes.ok) {
    try {
      stats = (await statsRes.json()) as AlertStatsDto;
    } catch {
      statsError = true;
    }
  } else {
    statsError = true;
  }

  // Recent alerts
  let recentAlerts: AlertListItem[] = [];
  if (recentRes.ok) {
    try {
      const page = (await recentRes.json()) as CursorPage<AlertListItem>;
      recentAlerts = page.items;
    } catch {
      // non-critical — show empty list
    }
  }

  // Assigned to me
  let assignedAlerts: Array<{
    id: string;
    title: string;
    status: AlertStatus;
    severity: string;
    detectedAt: string;
  }> = [];
  if (userId && assignedRes?.ok) {
    try {
      const page = (await assignedRes.json()) as CursorPage<{
        id: string;
        title: string;
        status: AlertStatus;
        severity: string;
        detectedAt: string;
      }>;
      assignedAlerts = page.items;
    } catch {
      // non-critical — show empty list
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Dashboard</h1>

      {/* Stat cards */}
      <section className="mb-8">
        <AlertStatsCards stats={stats} error={statsError} />
      </section>

      {/* Recent alerts */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Recent alerts</h2>
        <RecentAlertsList alerts={recentAlerts} />
      </section>

      {/* Assigned to me (hidden for VIEWER) */}
      <AssignedToMeList alerts={assignedAlerts} role={role} />

      {/* Interactive island — session refresh + signout + E2E testids */}
      <DashboardClient />
    </div>
  );
}
