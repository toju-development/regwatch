/**
 * `/settings/notifications` — RSC page for managing notification channels.
 *
 * Spec: `sdd/settings-ui-full/spec` — Notifications Settings Page.
 * Design: `sdd/settings-ui-full/design` — settings/notifications/page.tsx.
 *
 * Fetches `GET /notifications/channels` server-side via `apiServerFetch`
 * (same pattern as preferences and members pages). Passes channel list to
 * `<NotificationChannelsSection>` for client-side list management.
 *
 * Active-org resolution mirrors `/settings/preferences/page.tsx` —
 * `resolveActiveOrg(memberships)` reads the HttpOnly active-org cookie
 * + falls back to `pickDefault`.
 *
 * NO `pnpm build` after changes (project rule).
 */
import { redirect } from 'next/navigation';
import type { MembershipClaim } from '@regwatch/types';

import { auth } from '@/lib/auth';
import { resolveActiveOrg } from '@/lib/active-org-resolve';
import { apiServerFetch } from '@/lib/api-server';

import {
  NotificationChannelsSection,
  type ChannelData,
} from '@/components/settings/notification-channels-section';

interface ChannelsWire {
  channels: ChannelData[];
}

export const dynamic = 'force-dynamic';

export default async function NotificationsSettingsPage(): Promise<React.ReactElement> {
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
  const orgSlug = viewerMembership?.orgSlug ?? activeOrgId;

  const res = await apiServerFetch('/notifications/channels', {
    method: 'GET',
    orgId: activeOrgId,
  });

  if (!res.ok) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-8" data-testid="notifications-page">
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p
          role="alert"
          className="text-destructive mt-4 text-sm"
          data-testid="notifications-page-error"
        >
          Failed to load notification channels ({res.status}).
        </p>
      </main>
    );
  }

  const body = (await res.json()) as ChannelsWire;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8" data-testid="notifications-page">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="text-muted-foreground text-sm">
          Configure alert delivery for{' '}
          <span className="font-medium" data-testid="notifications-page-org-slug">
            {orgSlug}
          </span>
          .
        </p>
      </header>

      <NotificationChannelsSection channels={body.channels} orgId={activeOrgId} />
    </main>
  );
}
