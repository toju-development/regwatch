/**
 * `<LeaveOrgButton>` — header affordance on `/settings/members` for
 * the leave-org flow (self-leave, NOT admin-removes-other).
 *
 * Spec: `sdd/org-members/spec`
 *   - R-Membership-Remove (self-leave on non-personal org switches
 *     active org and revalidates; self-leave on personal org → 400
 *     `PERSONAL_ORG_UNREMOVABLE`).
 *   - R-Jwt-Invalidate-Cross-User (after self-leave the JWT `mv` claim
 *     is stale on the next request — we proactively call
 *     `useSession().update({})` to refresh it).
 *
 * Design: `sdd/org-members/design`
 *   - §0 #9 ("Self-leave UX flow") — DELETE → switch active org →
 *     revalidate → redirect. NO sign-out (the user keeps their personal
 *     org membership and stays authenticated).
 *   - §6 (frontend integration). Originally specified `<AlertDialog>`;
 *     deviated to `<Dialog>` (no AlertDialog primitive in
 *     `components/ui/`) — same UX, recorded in apply-progress.
 *
 * Foot-guns honoured:
 *   - `nextauth-v5-update-no-args-skips-post`: ALWAYS call
 *     `session.update?.({})` (empty object), never `update()`.
 *   - `radix-dropdown-modal-default-causes-body-lock-with-rsc-rerender`:
 *     not applicable here (Dialog, not DropdownMenu) but the equivalent
 *     concern would fire if `revalidatePath` raced the close — we
 *     close BEFORE navigating, and the redirect unmounts the tree.
 *
 * Visibility:
 *   - The button is only rendered when the viewer is NOT looking at
 *     their personal org (page-side gate via the `personalOrgId` prop).
 *     Defensive: server still enforces; the gate is purely UX so we
 *     don't expose a button that always errors.
 *
 * STALE_MEMBERSHIPS handling: after the action succeeds we run
 * `update({})` so the JWT loses the now-revoked membership. If the
 * action ITSELF returns `STALE_MEMBERSHIPS` (rare — the leaving user's
 * own claim was already stale at action time), we call `update({})`
 * once and prompt the user to retry. We do NOT signOut here — the
 * leaving user remains authenticated post-leave.
 */
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { leaveOrgAction } from './actions';
import { describeActionError } from './member-row';

export interface LeaveOrgButtonProps {
  /** The org the viewer is currently looking at — the org they would leave. */
  orgId: string;
  /** The viewer's `userId`. Resolved server-side and passed in. */
  selfUserId: string;
  /**
   * The viewer's personal org id, used as the active-org switch target
   * after a successful leave. `null` only in the (defensive) case where
   * the user has no surviving membership — the button should not render
   * at all in that state, but the action will skip the switch safely.
   */
  personalOrgId: string | null;
  /**
   * Org slug rendered in the confirm dialog so the user knows what
   * they're leaving.
   */
  orgSlug: string;
}

export function LeaveOrgButton({
  orgId,
  selfUserId,
  personalOrgId,
  orgSlug,
}: LeaveOrgButtonProps): React.ReactElement {
  const router = useRouter();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /**
   * Wrap `setOpen` so we ALSO clear the inline error whenever the dialog
   * closes (Cancel, ESC, backdrop click). Without this, a previous error
   * (e.g. STALE_MEMBERSHIPS) would re-paint stale on the next open.
   * Mirrors the equivalent guard in `<RemoveMemberDialog>`.
   */
  function handleOpenChange(next: boolean): void {
    setOpen(next);
    if (!next) setErrorMsg(null);
  }

  function handleConfirm(): void {
    setErrorMsg(null);
    startTransition(async () => {
      const result = await leaveOrgAction(orgId, selfUserId, personalOrgId);

      if (result.ok) {
        // Refresh the JWT so the now-revoked membership disappears from
        // `session.user.memberships`. Empty object is mandatory — see
        // foot-gun `nextauth-v5-update-no-args-skips-post`.
        await session.update?.({});
        setOpen(false);
        // Navigate to the dashboard — the layout will re-resolve
        // memberships against the refreshed JWT and the active-org
        // cookie that the action just wrote.
        router.replace('/dashboard');
        return;
      }

      // STALE: the leaving user's claim was already stale BEFORE the
      // action ran. Refresh once so the user can retry on a fresh JWT.
      // Do NOT sign out — design §0 #9 explicitly: leaving user keeps
      // their personal-org membership.
      if (result.code === 'STALE_MEMBERSHIPS') {
        await session.update?.({});
        setErrorMsg('Your session was out of date — please try again.');
        return;
      }

      setErrorMsg(describeActionError(result));
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        data-testid="leave-org-button"
      >
        Leave organization
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent data-testid="leave-org-dialog">
          <DialogHeader>
            <DialogTitle>Leave organization</DialogTitle>
            <DialogDescription>
              Leave <span className="font-medium">{orgSlug}</span>? You will lose access
              immediately. You will be switched back to your personal organization.
            </DialogDescription>
          </DialogHeader>
          {errorMsg ? (
            <p
              role="alert"
              className="text-destructive text-sm"
              data-testid="leave-org-dialog-error"
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
              data-testid="leave-org-dialog-confirm"
            >
              {pending ? 'Leaving…' : 'Leave'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
