/**
 * `<MembersList>` — server component for `/settings/members`.
 *
 * Spec: `sdd/org-members/spec` § R-Members-List ("Any active membership
 *   lists members"). The RSC page (`page.tsx`) fetches the list via
 *   {@link apiServerFetch} and hands it here; this component owns ONLY
 *   presentation + per-row gating.
 *
 * Design: `sdd/org-members/design` §6 (frontend integration). Renders a
 *   table with one `<MemberRow>` per entry. Pure presentational — no
 *   data fetching, no hooks (it's a server component).
 *
 * Per-row gating decisions:
 *   - `canManage`: true when the viewer is OWNER/ADMIN of `:orgId`.
 *     Drives the role `<Select>` and "Remove member" controls visible
 *     state. Self-target rows still show role select for self-downgrade
 *     (spec Q8) — the row itself enforces "self may only downgrade".
 *   - `isSelf`: highlighted with a "(you)" badge so the user always
 *     knows which row maps to their account. Server-side enforcement
 *     covers the actual self-promote / personal-org rules; this is UX.
 *
 * No hydration concern: the page is a leaf RSC under `(dashboard)/`,
 * so memberships + activeOrgId already live in the layout-mounted
 * `<ActiveOrgProvider>`. The list is server-side because the data is
 * server-only (Bearer JWT) and we want the SSR-no-flash UX.
 */
import type { Role } from '@regwatch/types';

import { MemberRow } from './member-row';
import type { MemberRowData } from './member-row';

export interface MembersListProps {
  /**
   * Org under which these members live. Forwarded to every row so the
   * mutation server actions know which org to target. Distinct from the
   * Zustand `activeOrgId` because the RSC is the source of truth for
   * "the org the user is currently looking at".
   */
  orgId: string;
  /** The current viewer's `userId` — drives the "(you)" badge + self-row gating. */
  currentUserId: string;
  /** The current viewer's role IN `orgId`. Drives `canManage`. */
  viewerRole: Role;
  /** Result of `GET /org/:orgId/members`, ordered by joinedAt ASC (server-side). */
  members: ReadonlyArray<MemberRowData>;
}

/**
 * Pure helper — `canManage` matrix. OWNER and ADMIN may mutate other
 * members (subject to server-side guards: ADMIN-vs-OWNER, last-OWNER,
 * personalOrg, etc.). ANALYST and VIEWER may only see the list and
 * self-leave / self-downgrade. Centralised here so the row + future
 * surfaces stay in lockstep with the spec.
 */
export function canManageMembers(role: Role): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export function MembersList({
  orgId,
  currentUserId,
  viewerRole,
  members,
}: MembersListProps): React.ReactElement {
  const canManage = canManageMembers(viewerRole);

  if (members.length === 0) {
    // Defensive: should never happen — every member always sees at
    // least themselves. Render an explicit empty state so the page
    // isn't blank when the contract is violated.
    return (
      <p className="text-muted-foreground text-sm" data-testid="members-list-empty" role="status">
        No members in this organization.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border" data-testid="members-list">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="px-4 py-2 font-medium">Member</th>
            <th className="px-4 py-2 font-medium">Role</th>
            <th className="px-4 py-2 font-medium">Joined</th>
            <th className="w-10 px-4 py-2" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <MemberRow
              key={m.userId}
              orgId={orgId}
              member={m}
              isSelf={m.userId === currentUserId}
              canManage={canManage}
              viewerRole={viewerRole}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
