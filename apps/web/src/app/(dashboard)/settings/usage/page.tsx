/**
 * `/settings/usage` — RSC page that surfaces monthly LLM cost vs the
 * hardcoded $10/mo cap.
 *
 * Spec: `sdd/scanner-vertical-ar/spec`
 *   - R-13-UsageWidget S1 ("Widget renders zero usage") + S2 ("at-cap
 *     state") + S3 ("widget proxy hits PROXY route" — covered by the
 *     B7.1 PROXY route foundation; initial render uses `apiServerFetch`
 *     direct per ADR-12 "RSC: NOT proxy from RSC").
 *
 * Design: `sdd/scanner-vertical-ar/design`
 *   - ADR-12 (page vs component: BOTH; data fetching: RSC →
 *     `apiServerFetch('/org/:orgId/usage/current')`).
 *
 * Active-org resolution mirrors `/settings/preferences/page.tsx` —
 * `resolveActiveOrg(memberships)` reads the HttpOnly active-org cookie
 * + falls back to `pickDefault`. We do NOT trust the Zustand store on
 * the server.
 *
 * No role gate at the page level: any member of the org may read usage
 * (R-12: "any role with org membership may read"). The apps/api
 * controller intentionally has NO `@Roles(...)` decorator on the GET
 * handler (verified via Reflector test in B6), and the 4-guard chain
 * (JwtAuthGuard → MembershipFreshnessGuard → OrgScopeGuard → RolesGuard
 * permitting all roles when undecorated) is the security boundary.
 */
import { redirect } from 'next/navigation';
import type { MembershipClaim } from '@regwatch/types';

import { auth } from '@/lib/auth';
import { resolveActiveOrg } from '@/lib/active-org-resolve';
import { apiServerFetch } from '@/lib/api-server';

import { UsageWidget } from '@/components/usage/usage-widget';
import type { UsageResponseDto } from '@/components/usage/types';

export const dynamic = 'force-dynamic';

export default async function UsageSettingsPage(): Promise<React.ReactElement> {
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

  const res = await apiServerFetch(`/org/${encodeURIComponent(activeOrgId)}/usage/current`, {
    method: 'GET',
    orgId: activeOrgId,
  });

  if (!res.ok) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-8" data-testid="usage-page">
        <h1 className="text-2xl font-semibold">Usage</h1>
        <p role="alert" className="text-destructive mt-4 text-sm" data-testid="usage-page-error">
          Failed to load usage ({res.status}).
        </p>
      </main>
    );
  }

  const usage = (await res.json()) as UsageResponseDto;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8" data-testid="usage-page">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Usage</h1>
        <p className="text-muted-foreground text-sm">
          Monthly LLM cost for{' '}
          <span className="font-medium" data-testid="usage-page-org-slug">
            {orgSlug}
          </span>
          .
        </p>
      </header>

      <UsageWidget usage={usage} />
    </main>
  );
}
