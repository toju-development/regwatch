/**
 * Component tests for `<RevokeInvitationDialog>`.
 *
 * Spec: `sdd/org-invitations/spec` § R-Invitation-Revoke.
 *
 * Foot-gun anchor: errorMsg MUST be cleared on dialog close so it does
 * not re-paint stale on the next open (`shadcn-dialog-local-state`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const revokeInvitationAction = vi.fn();
const onOpenChange = vi.fn();
const onError = vi.fn();

vi.mock('../actions.js', () => ({
  revokeInvitationAction: (...a: unknown[]) => revokeInvitationAction(...a),
}));

import { RevokeInvitationDialog } from '../revoke-invitation-dialog.js';
import type { InvitationRowData } from '../pending-invitations-list.js';

const invitation: InvitationRowData = {
  id: 'inv-1',
  email: 'bob@example.com',
  role: 'ANALYST',
  status: 'PENDING',
  expiresAt: '2026-05-05T00:00:00.000Z',
  invitedById: 'user-self',
  invitedByName: 'Alice',
  acceptedAt: null,
  revokedAt: null,
  createdAt: '2026-04-28T00:00:00.000Z',
};

beforeEach(() => {
  revokeInvitationAction.mockReset();
  onOpenChange.mockReset();
  onError.mockReset();
});

afterEach(() => {
  // no-op
});

describe('<RevokeInvitationDialog>', () => {
  it('calls revokeInvitationAction on confirm and closes on success', async () => {
    revokeInvitationAction.mockResolvedValue({ ok: true });

    render(
      <RevokeInvitationDialog
        orgId="org-1"
        invitation={invitation}
        open={true}
        onOpenChange={onOpenChange}
        onError={onError}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId(`revoke-invitation-dialog-confirm-${invitation.id}`));

    await waitFor(() =>
      expect(revokeInvitationAction).toHaveBeenCalledWith('org-1', invitation.id),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onError).not.toHaveBeenCalled();
  });

  it('shows ALREADY_ACCEPTED error inline and bubbles via onError, dialog stays open', async () => {
    revokeInvitationAction.mockResolvedValue({
      ok: false,
      code: 'ALREADY_ACCEPTED',
      error: 'already',
    });

    render(
      <RevokeInvitationDialog
        orgId="org-1"
        invitation={invitation}
        open={true}
        onOpenChange={onOpenChange}
        onError={onError}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId(`revoke-invitation-dialog-confirm-${invitation.id}`));

    const err = await screen.findByTestId(`revoke-invitation-dialog-error-${invitation.id}`);
    expect(err.textContent).toMatch(/already been accepted/i);
    expect(onError).toHaveBeenCalled();
    // Stayed open: parent NOT told to close.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('clears errorMsg when dialog closes (foot-gun: shadcn-dialog-local-state)', async () => {
    revokeInvitationAction.mockResolvedValue({
      ok: false,
      code: 'ALREADY_ACCEPTED',
      error: 'already',
    });

    const { rerender } = render(
      <RevokeInvitationDialog
        orgId="org-1"
        invitation={invitation}
        open={true}
        onOpenChange={onOpenChange}
        onError={onError}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId(`revoke-invitation-dialog-confirm-${invitation.id}`));
    await screen.findByTestId(`revoke-invitation-dialog-error-${invitation.id}`);

    // Close via Cancel — handleOpenChange(false) clears errorMsg locally.
    await user.click(screen.getByText('Cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // Re-open: stale error must NOT re-paint.
    rerender(
      <RevokeInvitationDialog
        orgId="org-1"
        invitation={invitation}
        open={true}
        onOpenChange={onOpenChange}
        onError={onError}
      />,
    );
    expect(screen.queryByTestId(`revoke-invitation-dialog-error-${invitation.id}`)).toBeNull();
  });
});
