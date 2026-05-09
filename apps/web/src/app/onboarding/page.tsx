/**
 * Onboarding page RSC — `apps/web/src/app/onboarding/page.tsx`.
 *
 * Server-side: resolves session + active org, fetches settings and
 * notification channels in parallel. If onboarding is already completed,
 * redirects immediately to `/dashboard`.
 *
 * Spec: `sdd/onboarding-flow/spec` — "RSC loads initial data",
 *   "Returning OWNER (onboarding already completed) → no redirect to /onboarding".
 * Design: `sdd/onboarding-flow/design` — onboarding/page.tsx RSC shell.
 *
 * NO `pnpm build` after changes (project rule).
 */
import { redirect } from 'next/navigation';
import type { MembershipClaim, SettingsJurisdictions } from '@regwatch/types';

import { auth } from '@/lib/auth';
import { resolveActiveOrg } from '@/lib/active-org-resolve';
import { apiServerFetch } from '@/lib/api-server';

/** Wire shape from `GET /org/:orgId/settings` (mirrors SettingsDto). */
interface SettingsWire {
  settings: {
    organizationId: string;
    jurisdictions: SettingsJurisdictions;
    scanSchedule: 'daily' | 'weekly' | 'custom';
    scanDay: string;
    scanHour: number;
    updatedAt: string;
    onboardingCompletedAt: string | null;
  };
}

/** Wire shape from `GET /notifications/channels`. */
interface NotificationChannelWire {
  id: string;
  provider: string;
  webhookUrl: string;
  channelName: string | null;
  isActive: boolean;
}

export default async function OnboardingPage(): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const memberships = ((session.user as unknown as { memberships?: MembershipClaim[] })
    .memberships ?? []) as ReadonlyArray<MembershipClaim>;

  const { activeOrgId } = await resolveActiveOrg(memberships);
  if (!activeOrgId) redirect('/login');

  // Fetch settings + channels in parallel.
  const [settingsRes, channelsRes] = await Promise.all([
    apiServerFetch(`/org/${activeOrgId}/settings`, { method: 'GET', orgId: activeOrgId }),
    apiServerFetch('/notifications/channels', { method: 'GET', orgId: activeOrgId }),
  ]);

  // If settings fetch fails, redirect to dashboard as a safe fallback.
  if (!settingsRes.ok) redirect('/dashboard');

  const { settings } = (await settingsRes.json()) as SettingsWire;

  // Guard: if onboarding already completed, skip the wizard.
  if (settings.onboardingCompletedAt !== null) {
    redirect('/dashboard');
  }

  const channels: NotificationChannelWire[] = channelsRes.ok
    ? ((await channelsRes.json()) as NotificationChannelWire[])
    : [];

  const initialChannel = channels.find((c) => c.provider === 'SLACK') ?? null;

  // Render a placeholder shell — the OnboardingWizard client component
  // will be added in Phase 3 (MVP-11 P3).
  return (
    <div className="mx-auto max-w-2xl px-4 py-12" data-testid="onboarding-page">
      <h1 className="mb-8 text-2xl font-semibold">Welcome to RegWatch</h1>
      {/* OnboardingWizard mounts here in Phase 3 */}
      <pre className="hidden" data-testid="onboarding-debug">
        {JSON.stringify({ orgId: activeOrgId, hasSlack: !!initialChannel }, null, 2)}
      </pre>
    </div>
  );
}
