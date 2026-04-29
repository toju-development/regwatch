/**
 * Component tests for `<InviteMemberForm>`.
 *
 * Spec: `sdd/org-invitations/spec` § R-Invitation-Issue.
 *
 * Mocks `issueInvitationAction` to assert call shape + UI branches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const issueInvitationAction = vi.fn();

vi.mock('../actions.js', () => ({
  issueInvitationAction: (...a: unknown[]) => issueInvitationAction(...a),
}));

import { InviteMemberForm } from '../invite-member-form.js';

beforeEach(() => {
  issueInvitationAction.mockReset();
});

afterEach(() => {
  // no-op
});

describe('<InviteMemberForm>', () => {
  it('submits with default role VIEWER and clears inputs on success', async () => {
    issueInvitationAction.mockResolvedValue({
      ok: true,
      invitation: {
        id: 'inv-1',
        email: 'bob@example.com',
        role: 'VIEWER',
        status: 'PENDING',
        expiresAt: '2026-05-05T00:00:00.000Z',
        invitedById: 'user-self',
      },
    });

    render(<InviteMemberForm orgId="org-1" viewerRole="OWNER" />);

    const user = userEvent.setup();
    const input = screen.getByTestId('invite-member-form-email') as HTMLInputElement;
    await user.type(input, 'bob@example.com');
    await user.click(screen.getByTestId('invite-member-form-submit'));

    await waitFor(() =>
      expect(issueInvitationAction).toHaveBeenCalledWith('org-1', 'bob@example.com', 'VIEWER'),
    );
    await screen.findByTestId('invite-member-form-success');
    expect(input.value).toBe('');
  });

  it('switches role via DropdownMenu and uses it on submit', async () => {
    issueInvitationAction.mockResolvedValue({ ok: true, invitation: { email: 'a@b.com' } });
    render(<InviteMemberForm orgId="org-1" viewerRole="OWNER" />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('invite-member-form-role-trigger'));
    await user.click(await screen.findByTestId('invite-member-form-role-option-ANALYST'));
    await user.type(screen.getByTestId('invite-member-form-email'), 'a@b.com');
    await user.click(screen.getByTestId('invite-member-form-submit'));

    await waitFor(() =>
      expect(issueInvitationAction).toHaveBeenCalledWith('org-1', 'a@b.com', 'ANALYST'),
    );
  });

  it('disables OWNER option for ADMIN viewers', async () => {
    render(<InviteMemberForm orgId="org-1" viewerRole="ADMIN" />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('invite-member-form-role-trigger'));
    const ownerOpt = await screen.findByTestId('invite-member-form-role-option-OWNER');
    expect(ownerOpt.getAttribute('data-disabled')).toBe('true');
  });

  it('surfaces ALREADY_MEMBER error inline', async () => {
    issueInvitationAction.mockResolvedValue({
      ok: false,
      code: 'ALREADY_MEMBER',
      error: 'already',
    });

    render(<InviteMemberForm orgId="org-1" viewerRole="OWNER" />);
    const user = userEvent.setup();
    await user.type(screen.getByTestId('invite-member-form-email'), 'a@b.com');
    await user.click(screen.getByTestId('invite-member-form-submit'));

    const err = await screen.findByTestId('invite-member-form-error');
    expect(err.textContent).toMatch(/already a member/i);
  });

  it('blocks submit when email is blank', async () => {
    render(<InviteMemberForm orgId="org-1" viewerRole="OWNER" />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('invite-member-form-submit'));

    const err = await screen.findByTestId('invite-member-form-error');
    expect(err.textContent).toMatch(/enter an email/i);
    expect(issueInvitationAction).not.toHaveBeenCalled();
  });
});
