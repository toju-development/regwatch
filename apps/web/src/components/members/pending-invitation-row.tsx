/**
 * `<PendingInvitationRow>` — client component, one row in the pending
 * invitations table. Hosts the revoke kebab + confirmation dialog.
 *
 * Spec: `sdd/org-invitations/spec`
 *   - R-Invitation-Revoke (per-row revoke; gated to OWNER/ADMIN via
 *     `canManage`; surfaces structured codes via inline error).
 *
 * Design: `sdd/org-invitations/design` §6 (frontend integration). Mirrors
 *   `<MemberRow>` shape — DropdownMenu kebab → Dialog confirm.
 *
 * Foot-guns honoured:
 *   - `radix-dropdown-modal-default-causes-body-lock-with-rsc-rerender`:
 *     `<DropdownMenu modal={false}>`.
 */
'use client';

import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { RevokeInvitationDialog } from './revoke-invitation-dialog';
import type { InvitationRowData } from './pending-invitations-list';

export interface PendingInvitationRowProps {
  orgId: string;
  invitation: InvitationRowData;
  canManage: boolean;
}

export function PendingInvitationRow({
  orgId,
  invitation,
  canManage,
}: PendingInvitationRowProps): React.ReactElement {
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  return (
    <tr data-testid={`pending-invitation-row-${invitation.id}`}>
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <span className="font-medium">{invitation.email}</span>
          {errorMsg ? (
            <span
              role="alert"
              className="text-destructive mt-1 text-xs"
              data-testid={`pending-invitation-row-error-${invitation.id}`}
            >
              {errorMsg}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-3">{invitation.role}</td>
      <td className="text-muted-foreground px-4 py-3 text-xs">{invitation.invitedByName ?? '—'}</td>
      <td className="text-muted-foreground px-4 py-3 text-xs">
        {new Date(invitation.expiresAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-3 text-right">
        {canManage ? (
          <>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Invitation actions"
                  data-testid={`pending-invitation-menu-${invitation.id}`}
                >
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={(event) => {
                    event.preventDefault();
                    setRevokeOpen(true);
                  }}
                  data-testid={`pending-invitation-revoke-trigger-${invitation.id}`}
                >
                  Revoke invitation
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <RevokeInvitationDialog
              orgId={orgId}
              invitation={invitation}
              open={revokeOpen}
              onOpenChange={setRevokeOpen}
              onError={(msg) => setErrorMsg(msg)}
            />
          </>
        ) : null}
      </td>
    </tr>
  );
}
