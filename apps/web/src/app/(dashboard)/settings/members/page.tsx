/**
 * `/settings/members` — RSC page that lists organization members.
 *
 * Spec: `sdd/org-members/spec`
 *   - R-Members-List ("Any active membership lists members" — RSC fetches
 *     the list with the viewer's Bearer JWT + `X-Org-Id`).
 *   - R-Membership-Update + R-Membership-Remove (the page hosts the
 *     `<MembersList>` and `<LeaveOrgButton>` surfaces that drive the
 *     mutation actions).
 *
 * Design: `sdd/org-members/design`
 *   - §6 (frontend integration). RSC fetches `/org/:orgId/members` AND
 *     `/org/me` (for `personalOrgId`); presentational layer is split
 *     into `<MembersList>` (server) + `<MemberRow>` (client) +
 *     `<LeaveOrgButton>` (client).
 *   - §0 #9 ("Self-leave UX flow") — `<LeaveOrgButton>` is the only
 *     surface that calls `leaveOrgAction`.
 *
 * Active-org resolution:
 *   - We do NOT trust the Zustand store on the server. Instead we call
 *     `resolveActiveOrg(memberships)` which reads the HttpOnly active-
 *     org cookie + falls back to `pickDefault`. This guarantees the
 *     server-side fetch and the client-mirrored store agree on the
 *     orgId after a hard navigation.
 *
 * Wire shape (mirrors `apps/api/src/modules/members/members.controller.ts`):
 *   - GET /org/:orgId/members → `{ members: MemberListEntryDto[] }`.
 *   - GET /org/me             → `{ memberships: MeMembershipDto[],
 *                                   activeOrgId: string|null }`.
 *
 * Personal-org gating:
 *   - `<LeaveOrgButton>` only renders when the viewer is NOT looking at
 *     their personal org. The server enforces `PERSONAL_ORG_UNREMOVABLE`;
 *     this gate is purely UX (don't expose a button that always errors).
 *
 * No `pnpm build` after changes (project rule).
 */
import { redirect } from 'next/navigation';
import type { MembershipClaim, Role } from '@regwatch/types';

import { auth } from '@/lib/auth';
import { resolveActiveOrg } from '@/lib/active-org-resolve';
import { apiServerFetch } from '@/lib/api-server';

import { MembersList, canManageMembers } from '@/components/members/members-list';
import type { MemberRowData } from '@/components/members/member-row';
import { LeaveOrgButton } from '@/components/members/leave-org-button';
import { InviteMemberForm } from '@/components/members/invite-member-form';
import { PendingInvitationsList } from '@/components/members/pending-invitations-list';
import type { InvitationRowData } from '@/components/members/pending-invitations-list';

/**
 * Wire shape of `GET /org/me` (subset of `MeResponseDto` we read here).
 * Re-declared to avoid a transitive dep on `apps/api` types.
 */
interface MeWire {
  memberships: ReadonlyArray<{
    orgId: string;
    orgSlug: string;
    orgName: string;
    role: Role;
    isPersonal: boolean;
  }>;
  activeOrgId: string | null;
}

interface MembersListWire {
  members: ReadonlyArray<MemberRowData>;
}

interface InvitationsListWire {
  invitations: ReadonlyArray<InvitationRowData>;
}

export const dynamic = 'force-dynamic';

export default async function MembersSettingsPage(): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const user = session.user as unknown as {
    id?: string;
    userId?: string;
    memberships?: MembershipClaim[];
  };
  const selfUserId = user.id ?? user.userId ?? '';
  const memberships = (user.memberships ?? []) as ReadonlyArray<MembershipClaim>;

  const { activeOrgId } = await resolveActiveOrg(memberships);
  if (activeOrgId === null) {
    // Defensive: every authenticated user has ≥1 membership (auto-org
    // invariant). Reaching here means the JWT had no memberships claim
    // — bounce back to the dashboard which has its own empty-state.
    redirect('/dashboard');
  }

  const viewerMembership = memberships.find((m) => m.organizationId === activeOrgId);
  const viewerRole: Role = (viewerMembership?.role ?? 'VIEWER') as Role;
  const orgSlug = viewerMembership?.orgSlug ?? activeOrgId;

  // Fetch list + /org/me + pending invitations in parallel. `/org/me` is the
  // source of truth for `isPersonal` (the JWT memberships claim doesn't
  // carry it). Invitations list runs even for ANALYST/VIEWER — they may
  // view it (R-Invitation-List) but won't see a revoke control.
  const [listRes, meRes, invitationsRes] = await Promise.all([
    apiServerFetch(`/org/${encodeURIComponent(activeOrgId)}/members`, {
      method: 'GET',
      orgId: activeOrgId,
    }),
    apiServerFetch('/org/me', {
      method: 'GET',
      orgId: activeOrgId,
    }),
    apiServerFetch(`/org/${encodeURIComponent(activeOrgId)}/invitations`, {
      method: 'GET',
      orgId: activeOrgId,
    }),
  ]);

  if (!listRes.ok) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-8" data-testid="members-page">
        <h1 className="text-2xl font-semibold">Members</h1>
        <p role="alert" className="text-destructive mt-4 text-sm" data-testid="members-page-error">
          Failed to load members ({listRes.status}).
        </p>
      </main>
    );
  }

  const listBody = (await listRes.json()) as MembersListWire;
  const me = meRes.ok ? ((await meRes.json()) as MeWire) : null;
  // Invitations are best-effort: a non-2xx (e.g. ANALYST/VIEWER hitting a
  // RolesGuard 403 in some configurations) renders an empty list rather
  // than blocking the whole page. Spec R-Invitation-List allows all
  // members to view the list, so 403 here would be an upstream config
  // drift — surface it via the empty state, not a fatal error.
  const invitationsBody: InvitationsListWire = invitationsRes.ok
    ? ((await invitationsRes.json()) as InvitationsListWire)
    : { invitations: [] };

  const personalOrgId = me?.memberships.find((m) => m.isPersonal)?.orgId ?? null;
  const isPersonalOrg = personalOrgId !== null && personalOrgId === activeOrgId;
  const canManage = canManageMembers(viewerRole);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8" data-testid="members-page">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Members</h1>
          <p className="text-muted-foreground text-sm">
            Manage who has access to{' '}
            <span className="font-medium" data-testid="members-page-org-slug">
              {orgSlug}
            </span>
            .
          </p>
        </div>
        {!isPersonalOrg ? (
          <LeaveOrgButton
            orgId={activeOrgId}
            selfUserId={selfUserId}
            personalOrgId={personalOrgId}
            orgSlug={orgSlug}
          />
        ) : null}
      </header>

      <MembersList
        orgId={activeOrgId}
        currentUserId={selfUserId}
        viewerRole={viewerRole}
        members={listBody.members}
      />

      {/* Invitations live BELOW the members list per design §6: the form
       * comes first (action), pending list second (state), members table
       * third (truth). Personal-org gates the entire invitations stack
       * because PERSONAL_ORG_NOT_INVITABLE makes both surfaces useless. */}
      {!isPersonalOrg ? (
        <section className="mt-8 flex flex-col gap-4" data-testid="invitations-section">
          <h2 className="text-lg font-semibold">Invitations</h2>
          {canManage ? <InviteMemberForm orgId={activeOrgId} viewerRole={viewerRole} /> : null}
          <PendingInvitationsList
            orgId={activeOrgId}
            canManage={canManage}
            invitations={invitationsBody.invitations}
          />
        </section>
      ) : null}
    </main>
  );
}
