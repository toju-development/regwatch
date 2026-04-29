/**
 * `<PendingInvitationsList>` — server component for `/settings/members`.
 *
 * Spec: `sdd/org-invitations/spec`
 *   - R-Invitation-List ("Member views pending invitations"; PENDING-only,
 *     ordered by createdAt DESC server-side).
 *   - R-Invitation-Revoke (per-row revoke control gated to OWNER/ADMIN).
 *
 * Design: `sdd/org-invitations/design` §6 (frontend integration).
 *   Pure presentational: the parent RSC fetches the list and hands it
 *   here; this component renders the table + delegates the revoke
 *   confirmation to a per-row client component.
 *
 * Per-row gating:
 *   - All members see the list.
 *   - Revoke kebab is only rendered when `canManage` (OWNER/ADMIN of orgId).
 *
 * Empty-state: when there are no pending invitations, render a quiet
 *   "no pending invitations" line — explicitly distinct from the
 *   members-list empty-state because here zero is the common case.
 */
import type { Role } from '@regwatch/types';

import { PendingInvitationRow } from './pending-invitation-row';
import type { InvitationsActionResult } from './actions';

/**
 * Wire shape for one row — mirrors `InvitationListEntryDto` from
 * `apps/api/src/modules/invitations/invitations.controller.ts` (spec
 * R-Invitation-List). Re-declared in the web layer so component types
 * do NOT take a transitive dep on `apps/api` types.
 */
export interface InvitationRowData {
  id: string;
  email: string;
  role: Role;
  status: 'PENDING';
  expiresAt: string;
  invitedById: string | null;
  invitedByName: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface PendingInvitationsListProps {
  /** Org under which these invitations live. Forwarded to revoke action. */
  orgId: string;
  /** True when viewer may revoke (OWNER/ADMIN). */
  canManage: boolean;
  /** Result of `GET /org/:orgId/invitations`, PENDING-only, createdAt DESC. */
  invitations: ReadonlyArray<InvitationRowData>;
}

/**
 * Translate an {@link InvitationsActionResult} `code` to a user-facing
 * string. Centralised so the invite form + revoke dialog render the
 * same copy for the same server outcome.
 */
export function describeInvitationActionError(result: InvitationsActionResult): string {
  switch (result.code) {
    case 'PERSONAL_ORG_NOT_INVITABLE':
      return 'You cannot invite members to a personal organization.';
    case 'INVALID_EMAIL':
      return 'That email address is not valid.';
    case 'INVALID_ROLE':
      return 'That role is not valid.';
    case 'OWNER_INVITE_REQUIRES_OWNER':
      return 'Only an OWNER can invite a member as OWNER.';
    case 'ALREADY_MEMBER':
      return 'That email is already a member of this organization.';
    case 'ALREADY_ACCEPTED':
      return 'This invitation has already been accepted.';
    case 'STALE_MEMBERSHIPS':
      return 'Your session is out of date. Please refresh and try again.';
    case 'UNAUTHENTICATED':
      return 'Your session has expired. Please sign in again.';
    case 'FORBIDDEN':
      return 'You are not allowed to perform this action.';
    case 'NOT_FOUND':
      return 'Invitation not found.';
    case 'BAD_REQUEST':
      return result.error ?? 'Invalid request.';
    default:
      return result.error ?? 'An unexpected error occurred.';
  }
}

export function PendingInvitationsList({
  orgId,
  canManage,
  invitations,
}: PendingInvitationsListProps): React.ReactElement {
  if (invitations.length === 0) {
    return (
      <p
        className="text-muted-foreground text-sm"
        data-testid="pending-invitations-empty"
        role="status"
      >
        No pending invitations.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border" data-testid="pending-invitations-list">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="px-4 py-2 font-medium">Email</th>
            <th className="px-4 py-2 font-medium">Role</th>
            <th className="px-4 py-2 font-medium">Invited by</th>
            <th className="px-4 py-2 font-medium">Expires</th>
            <th className="w-10 px-4 py-2" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {invitations.map((inv) => (
            <PendingInvitationRow
              key={inv.id}
              orgId={orgId}
              invitation={inv}
              canManage={canManage}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
