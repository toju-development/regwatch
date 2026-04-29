/**
 * Component tests for `<AcceptInvitationButton>`.
 *
 * Spec: `sdd/org-invitations/spec` § R-Invitation-Accept.
 *
 * Foot-gun anchor: `session.update({})` MUST be called with empty object
 * after a successful accept (`nextauth-v5-update-no-args-skips-post`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const acceptInvitationAction = vi.fn();
const sessionUpdate = vi.fn();
const routerReplace = vi.fn();

// `accept-invitation-button.tsx` imports `./actions` — relative to the
// test file (`__tests__/`), that resolves to `../actions.js`.
vi.mock('../actions.js', () => ({
  acceptInvitationAction: (...a: unknown[]) => acceptInvitationAction(...a),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ update: sessionUpdate, data: null, status: 'authenticated' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn(), refresh: vi.fn() }),
}));

import { AcceptInvitationButton } from '../accept-invitation-button.js';

beforeEach(() => {
  acceptInvitationAction.mockReset();
  sessionUpdate.mockReset();
  routerReplace.mockReset();
});

afterEach(() => {
  // no-op
});

describe('<AcceptInvitationButton>', () => {
  it('calls action, refreshes session with {}, and redirects on success', async () => {
    acceptInvitationAction.mockResolvedValue({ ok: true, orgId: 'org-1', role: 'ANALYST' });
    render(<AcceptInvitationButton token="tok-1" orgName="globex" />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('accept-invitation-button'));

    await waitFor(() => expect(acceptInvitationAction).toHaveBeenCalledWith('tok-1'));
    // Empty-object literal mandatory — foot-gun nextauth-v5-update-no-args-skips-post.
    await waitFor(() => expect(sessionUpdate).toHaveBeenCalledWith({}));
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/settings/members'));
  });

  it('shows EMAIL_MISMATCH error and does not redirect', async () => {
    acceptInvitationAction.mockResolvedValue({ ok: false, code: 'EMAIL_MISMATCH' });
    render(<AcceptInvitationButton token="tok-1" orgName="globex" />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('accept-invitation-button'));

    const err = await screen.findByTestId('accept-invitation-error');
    expect(err.textContent).toMatch(/different email/i);
    expect(routerReplace).not.toHaveBeenCalled();
    expect(sessionUpdate).not.toHaveBeenCalled();
  });

  it('on STALE_MEMBERSHIPS refreshes session and surfaces retry message', async () => {
    acceptInvitationAction.mockResolvedValue({ ok: false, code: 'STALE_MEMBERSHIPS' });
    render(<AcceptInvitationButton token="tok-1" orgName="globex" />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('accept-invitation-button'));

    const err = await screen.findByTestId('accept-invitation-error');
    expect(err.textContent).toMatch(/out of date/i);
    expect(sessionUpdate).toHaveBeenCalledWith({});
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it('shows INVITATION_EXPIRED error', async () => {
    acceptInvitationAction.mockResolvedValue({ ok: false, code: 'INVITATION_EXPIRED' });
    render(<AcceptInvitationButton token="tok-1" orgName="globex" />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('accept-invitation-button'));

    const err = await screen.findByTestId('accept-invitation-error');
    expect(err.textContent).toMatch(/expired/i);
  });
});
