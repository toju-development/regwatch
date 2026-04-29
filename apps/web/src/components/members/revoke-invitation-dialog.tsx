/**
 * `<RevokeInvitationDialog>` — confirm dialog for revoking a PENDING invitation.
 *
 * Spec: `sdd/org-invitations/spec`
 *   - R-Invitation-Revoke (idempotent on REVOKED, 410 on ACCEPTED).
 *
 * Design: `sdd/org-invitations/design` §6 (frontend integration). Mirrors
 *   `<RemoveMemberDialog>` shape: controlled open, inline error,
 *   `errorMsg` cleared on close to avoid stale-error re-paint
 *   (foot-gun shadcn-dialog-local-state).
 *
 * Why `<Dialog>` not `<AlertDialog>`: `apps/web/src/components/ui/` does
 *   not ship an AlertDialog primitive — same deviation as
 *   `<RemoveMemberDialog>`.
 */
'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { revokeInvitationAction } from './actions';
import { describeInvitationActionError } from './pending-invitations-list';
import type { InvitationRowData } from './pending-invitations-list';

export interface RevokeInvitationDialogProps {
  /** Org id forwarded to the server action. */
  orgId: string;
  /** The invitation targeted by this dialog. */
  invitation: InvitationRowData;
  /** Controlled open state. */
  open: boolean;
  /** Open-state setter. */
  onOpenChange: (open: boolean) => void;
  /**
   * Bubble error messages up to the parent (pending-list row) so they
   * persist after dialog close. The dialog ALSO renders inline while open.
   */
  onError?: (message: string) => void;
}

export function RevokeInvitationDialog({
  orgId,
  invitation,
  open,
  onOpenChange,
  onError,
}: RevokeInvitationDialogProps): React.ReactElement {
  const [pending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function handleConfirm(): void {
    setErrorMsg(null);
    startTransition(async () => {
      const result = await revokeInvitationAction(orgId, invitation.id);
      if (!result.ok) {
        const message = describeInvitationActionError(result);
        setErrorMsg(message);
        onError?.(message);
        return;
      }
      onOpenChange(false);
    });
  }

  /**
   * Wrap parent-controlled `onOpenChange` so we ALSO clear the inline
   * error whenever the dialog closes (Cancel, ESC, backdrop, success).
   * Without this, a previous error would re-paint on the next open
   * (foot-gun shadcn-dialog-local-state).
   */
  function handleOpenChange(next: boolean): void {
    onOpenChange(next);
    if (!next) setErrorMsg(null);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid={`revoke-invitation-dialog-${invitation.id}`}>
        <DialogHeader>
          <DialogTitle>Revoke invitation</DialogTitle>
          <DialogDescription>
            Revoke the invitation for <span className="font-medium">{invitation.email}</span>? They
            will no longer be able to accept it.
          </DialogDescription>
        </DialogHeader>
        {errorMsg ? (
          <p
            role="alert"
            className="text-destructive text-sm"
            data-testid={`revoke-invitation-dialog-error-${invitation.id}`}
          >
            {errorMsg}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow"
            disabled={pending}
            onClick={handleConfirm}
            data-testid={`revoke-invitation-dialog-confirm-${invitation.id}`}
          >
            {pending ? 'Revoking…' : 'Revoke'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
