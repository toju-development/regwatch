/**
 * `/settings/preferences` — RSC page that renders the per-org settings
 * form (jurisdictions + scan cadence).
 *
 * Spec: `sdd/jurisdictions-config/spec`
 *   - R-Settings-Preferences-Page (Page renders current settings;
 *     OWNER edits and saves; ANALYST cannot submit; Validation error
 *     surfaces inline; revalidatePath only on success).
 *
 * Design: `sdd/jurisdictions-config/design`
 *   - §6 (frontend integration). RSC fetches `/org/:orgId/settings`
 *     server-side via `apiServerFetch` (NOT the proxy — the proxy is
 *     for browser-side fetches only). The lazy `getOrCreate` chokepoint
 *     means a cold visit returns `DEFAULT_SETTINGS` (7-LatAm, weekly,
 *     mon, 08:00) on first read.
 *   - §0 D11 (server action upserts via PUT; full-replace, no PATCH).
 *
 * Active-org resolution mirrors `/settings/members/page.tsx` —
 * `resolveActiveOrg(memberships)` reads the HttpOnly active-org cookie
 * + falls back to `pickDefault`. We do NOT trust the Zustand store on
 * the server.
 *
 * Role-based UI gating: ANALYST + VIEWER see the form rendered but the
 * submit button is disabled (see `<PreferencesForm canEdit={...}>`).
 * The server (RolesGuard on PUT) is the actual security boundary.
 */
import { redirect } from 'next/navigation';
import type { MembershipClaim, Role, SettingsJurisdictions } from '@regwatch/types';

import { auth } from '@/lib/auth';
import { resolveActiveOrg } from '@/lib/active-org-resolve';
import { apiServerFetch } from '@/lib/api-server';

import { PreferencesForm } from '@/components/settings/preferences-form';

/**
 * Wire shape of `GET /org/:orgId/settings` (mirrors
 * `apps/api/src/modules/settings/dto/settings-response.dto.ts`).
 * Re-declared here to avoid a transitive dep on `apps/api` types.
 */
interface SettingsWire {
  settings: {
    organizationId: string;
    jurisdictions: SettingsJurisdictions;
    scanSchedule: 'daily' | 'weekly' | 'custom' | 'monthly';
    scanDay: string;
    scanHour: number;
    scanDayOfMonth?: number;
    updatedAt: string;
  };
}

export const dynamic = 'force-dynamic';

/**
 * Roles permitted to mutate settings (mirrors `@Roles('OWNER','ADMIN')`
 * on the controller's PUT handler — see
 * `apps/api/src/modules/settings/settings.controller.ts`).
 */
function canEditSettings(role: Role): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export default async function PreferencesSettingsPage(): Promise<React.ReactElement> {
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
  const viewerRole: Role = (viewerMembership?.role ?? 'VIEWER') as Role;
  const orgSlug = viewerMembership?.orgSlug ?? activeOrgId;

  const res = await apiServerFetch(`/org/${encodeURIComponent(activeOrgId)}/settings`, {
    method: 'GET',
    orgId: activeOrgId,
  });

  if (!res.ok) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-8" data-testid="preferences-page">
        <h1 className="text-2xl font-semibold">Preferences</h1>
        <p
          role="alert"
          className="text-destructive mt-4 text-sm"
          data-testid="preferences-page-error"
        >
          Failed to load settings ({res.status}).
        </p>
      </main>
    );
  }

  const body = (await res.json()) as SettingsWire;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8" data-testid="preferences-page">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Preferences</h1>
        <p className="text-muted-foreground text-sm">
          Configure jurisdictions and scan cadence for{' '}
          <span className="font-medium" data-testid="preferences-page-org-slug">
            {orgSlug}
          </span>
          .
        </p>
      </header>

      <PreferencesForm
        orgId={activeOrgId}
        canEdit={canEditSettings(viewerRole)}
        initial={{
          jurisdictions: body.settings.jurisdictions,
          scanSchedule: body.settings.scanSchedule,
          scanDay: body.settings.scanDay,
          scanHour: body.settings.scanHour,
          ...(body.settings.scanDayOfMonth !== undefined && {
            scanDayOfMonth: body.settings.scanDayOfMonth,
          }),
        }}
      />
    </main>
  );
}
