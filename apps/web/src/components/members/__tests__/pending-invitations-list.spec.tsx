/**
 * Component tests for `<PendingInvitationsList>` + `<PendingInvitationRow>`.
 *
 * Spec: `sdd/org-invitations/spec` § R-Invitation-List + R-Invitation-Revoke.
 * Spec: `sdd/team-management-ui/spec` § R-Invitation-Resend.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../actions.js', () => ({
  revokeInvitationAction: vi.fn(),
  issueInvitationAction: vi.fn(),
}));

import { PendingInvitationsList } from '../pending-invitations-list.js';
import type { InvitationRowData } from '../pending-invitations-list.js';
import { issueInvitationAction } from '../actions.js';

import { PendingInvitationsList } from '../pending-invitations-list.js';
import type { InvitationRowData } from '../pending-invitations-list.js';

const invitations: ReadonlyArray<InvitationRowData> = [
  {
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
  },
];

describe('<PendingInvitationsList>', () => {
  it('renders empty state when there are no invitations', () => {
    render(<PendingInvitationsList orgId="org-1" canManage={true} invitations={[]} />);
    expect(screen.getByTestId('pending-invitations-empty')).toBeTruthy();
  });

  it('renders rows and shows the revoke kebab when canManage', () => {
    render(<PendingInvitationsList orgId="org-1" canManage={true} invitations={invitations} />);
    expect(screen.getByTestId('pending-invitation-row-inv-1')).toBeTruthy();
    expect(screen.getByTestId('pending-invitation-menu-inv-1')).toBeTruthy();
  });

  it('hides the revoke kebab when canManage is false', () => {
    render(<PendingInvitationsList orgId="org-1" canManage={false} invitations={invitations} />);
    expect(screen.getByTestId('pending-invitation-row-inv-1')).toBeTruthy();
    expect(screen.queryByTestId('pending-invitation-menu-inv-1')).toBeNull();
  });

  it('calls issueInvitationAction with same email+role when Resend is clicked', async () => {
    vi.mocked(issueInvitationAction).mockResolvedValueOnce({ ok: true, invitation: {} as never });
    const user = userEvent.setup();
    render(<PendingInvitationsList orgId="org-1" canManage={true} invitations={invitations} />);
    await user.click(screen.getByTestId('pending-invitation-menu-inv-1'));
    await user.click(screen.getByTestId('pending-invitation-resend-trigger-inv-1'));
    expect(issueInvitationAction).toHaveBeenCalledWith('org-1', 'bob@example.com', 'ANALYST');
  });

  it('surfaces an error when Resend fails', async () => {
    vi.mocked(issueInvitationAction).mockResolvedValueOnce({
      ok: false,
      error: 'Something went wrong',
      code: 'UNKNOWN' as never,
    });
    const user = userEvent.setup();
    render(<PendingInvitationsList orgId="org-1" canManage={true} invitations={invitations} />);
    await user.click(screen.getByTestId('pending-invitation-menu-inv-1'));
    await user.click(screen.getByTestId('pending-invitation-resend-trigger-inv-1'));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('surfaces an error when Resend fails', async () => {
    vi.mocked(issueInvitationAction).mockResolvedValueOnce({
      ok: false,
      error: 'Something went wrong',
      code: 'UNKNOWN' as never,
    });
    const user = userEvent.setup();
    render(<PendingInvitationsList orgId="org-1" canManage={true} invitations={invitations} />);
    await user.click(screen.getByTestId('pending-invitation-menu-inv-1'));
    await user.click(screen.getByTestId('pending-invitation-resend-trigger-inv-1'));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
