/**
 * `<AcceptInvitationButton>` — confirm-and-accept button on `/accept/[token]`.
 *
 * Spec: `sdd/org-invitations/spec` § R-Invitation-Accept.
 *
 * Design: `sdd/org-invitations/design` §0 D11 (accept flow:
 *   action → `setActiveOrgIdCookie` → `revalidatePath('/', 'layout')`;
 *   client → `session.update({})` → `router.replace('/settings/members')`).
 *
 * Foot-guns honoured:
 *   - `nextauth-v5-update-no-args-skips-post`: ALWAYS call
 *     `session.update?.({})` (empty object), never `update()`. Without
 *     it the JWT keeps the pre-accept memberships claim and the dashboard
 *     would not show the new org until next page load.
 */
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

import { Button } from '@/components/ui/button';

import { acceptInvitationAction } from './actions';

export interface AcceptInvitationButtonProps {
  /** Invitation token from the URL params. */
  token: string;
  /** Pretty org name for the success state — purely cosmetic. */
  orgName: string;
}

function describeAcceptError(code: string | undefined, fallback: string | undefined): string {
  switch (code) {
    case 'EMAIL_MISMATCH':
      return 'This invitation is for a different email address. Sign in with the invited email to accept.';
    case 'INVITATION_NOT_FOUND':
      return 'This invitation could not be found.';
    case 'INVITATION_REVOKED':
      return 'This invitation has been revoked.';
    case 'INVITATION_EXPIRED':
      return 'This invitation has expired.';
    case 'INVITATION_ACCEPTED':
      return 'This invitation has already been accepted.';
    case 'STALE_MEMBERSHIPS':
      return 'Your session was out of date — please try again.';
    case 'UNAUTHENTICATED':
      return 'Your session has expired. Please sign in again.';
    case 'FORBIDDEN':
      return 'You are not allowed to accept this invitation.';
    default:
      return fallback ?? 'An unexpected error occurred.';
  }
}

export function AcceptInvitationButton({
  token,
  orgName,
}: AcceptInvitationButtonProps): React.ReactElement {
  const router = useRouter();
  const session = useSession();
  const [pending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function handleAccept(): void {
    setErrorMsg(null);
    startTransition(async () => {
      const result = await acceptInvitationAction(token);

      if (result.ok) {
        // Refresh JWT so memberships claim picks up the new Membership.
        // Empty object literal mandatory — foot-gun
        // `nextauth-v5-update-no-args-skips-post`.
        await session.update?.({});
        router.replace('/settings/members');
        return;
      }

      // STALE: caller's claim was already stale BEFORE the action.
      // Refresh once and surface a retry prompt.
      if (result.code === 'STALE_MEMBERSHIPS') {
        await session.update?.({});
        setErrorMsg(describeAcceptError(result.code, result.error));
        return;
      }

      setErrorMsg(describeAcceptError(result.code, result.error));
    });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="accept-invitation-panel">
      <Button
        type="button"
        onClick={handleAccept}
        disabled={pending}
        data-testid="accept-invitation-button"
      >
        {pending ? 'Accepting…' : `Accept and join ${orgName}`}
      </Button>
      {errorMsg ? (
        <p role="alert" className="text-destructive text-sm" data-testid="accept-invitation-error">
          {errorMsg}
        </p>
      ) : null}
    </div>
  );
}
