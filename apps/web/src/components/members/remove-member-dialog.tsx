/**
 * `<RemoveMemberDialog>` — confirm dialog for admin-removes-other.
 *
 * Spec: `sdd/org-members/spec`
 *   - R-Membership-Remove ("Admin removes another member" success path,
 *     `LAST_OWNER`, `OWNER_REMOVE_REQUIRES_OWNER`, `PERSONAL_ORG_UNREMOVABLE`).
 *
 * Design: `sdd/org-members/design` §6 (frontend integration). The
 *   originally-specified shadcn `<AlertDialog>` primitive does not ship
 *   in `apps/web/src/components/ui/`, so we reuse the existing
 *   `<Dialog>` with destructive-styled action button — same UX,
 *   matches the OrgSwitcher create-org dialog pattern, recorded as a
 *   design deviation in apply-progress.
 *
 * Behaviour:
 *   - Open is fully controlled by the parent (`<MemberRow>`).
 *   - Confirm calls {@link removeMemberAction}; on success the dialog
 *     closes (parent flips `open` to `false` after a successful action
 *     completes) and `revalidatePath('/settings/members')` (server-side)
 *     re-fetches the list.
 *   - On error the dialog stays open with an inline error message AND
 *     bubbles the error up to the parent via `onError` (so the row can
 *     surface it once the dialog is dismissed).
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

import { removeMemberAction } from './actions';
import type { MemberRowData } from './member-row';
import { describeActionError } from './member-row';

export interface RemoveMemberDialogProps {
  /** Org id forwarded to the server action. */
  orgId: string;
  /** The member targeted by this dialog. */
  member: MemberRowData;
  /** Controlled open state. */
  open: boolean;
  /** Open-state setter. */
  onOpenChange: (open: boolean) => void;
  /**
   * Bubble error messages up to the row so they persist after dialog
   * close. The dialog ALSO renders the message inline while it is open.
   */
  onError?: (message: string) => void;
}

export function RemoveMemberDialog({
  orgId,
  member,
  open,
  onOpenChange,
  onError,
}: RemoveMemberDialogProps): React.ReactElement {
  const [pending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function handleConfirm(): void {
    setErrorMsg(null);
    startTransition(async () => {
      const result = await removeMemberAction(orgId, member.userId);
      if (!result.ok) {
        const message = describeActionError(result);
        setErrorMsg(message);
        onError?.(message);
        return;
      }
      // Success: close. Parent's `revalidatePath` re-fetches the list.
      onOpenChange(false);
    });
  }

  /**
   * Wrap the parent-controlled `onOpenChange` so we ALSO clear the
   * inline error whenever the dialog closes (Cancel, ESC, backdrop
   * click, success). Without this, a previous error (LAST_OWNER,
   * OWNER_REMOVE_REQUIRES_OWNER, etc.) would re-paint on the next open
   * even though the user dismissed it. The error already bubbled up to
   * the row via `onError` so it isn't lost — the row decides whether to
   * keep showing it.
   */
  function handleOpenChange(next: boolean): void {
    onOpenChange(next);
    if (!next) setErrorMsg(null);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid={`remove-member-dialog-${member.userId}`}>
        <DialogHeader>
          <DialogTitle>Remove member</DialogTitle>
          <DialogDescription>
            Remove <span className="font-medium">{member.name ?? member.email}</span> from this
            organization? They will lose access immediately.
          </DialogDescription>
        </DialogHeader>
        {errorMsg ? (
          <p
            role="alert"
            className="text-destructive text-sm"
            data-testid={`remove-member-dialog-error-${member.userId}`}
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
            data-testid={`remove-member-dialog-confirm-${member.userId}`}
          >
            {pending ? 'Removing…' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
