/**
 * Component tests for `<LeaveOrgButton>`.
 *
 * Spec: `sdd/org-members/spec` R-Membership-Remove (self-leave non-personal),
 *   R-Jwt-Invalidate-Cross-User (`STALE_MEMBERSHIPS` triggers a session
 *   refresh; no signOut for self-leave).
 *
 * Mocks: server action + `next-auth/react` `useSession` + `next/navigation`
 *   `useRouter`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const leaveOrgAction = vi.fn();
const sessionUpdate = vi.fn();
const routerReplace = vi.fn();

vi.mock('../actions.js', () => ({
  leaveOrgAction: (...a: unknown[]) => leaveOrgAction(...a),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ update: sessionUpdate, data: null, status: 'authenticated' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn(), refresh: vi.fn() }),
}));

import { LeaveOrgButton } from '../leave-org-button.js';

beforeEach(() => {
  leaveOrgAction.mockReset();
  sessionUpdate.mockReset();
  routerReplace.mockReset();
});

afterEach(() => {
  // no-op
});

function renderButton(): void {
  render(
    <LeaveOrgButton
      orgId="org-other"
      selfUserId="user-self"
      personalOrgId="org-personal"
      orgSlug="globex"
    />,
  );
}

describe('<LeaveOrgButton>', () => {
  it('opens the confirm dialog and calls leaveOrgAction with the right args', async () => {
    leaveOrgAction.mockResolvedValue({ ok: true, switchedTo: 'org-personal' });
    renderButton();

    const user = userEvent.setup();
    await user.click(screen.getByTestId('leave-org-button'));
    const confirm = await screen.findByTestId('leave-org-dialog-confirm');
    await user.click(confirm);

    await waitFor(() =>
      expect(leaveOrgAction).toHaveBeenCalledWith('org-other', 'user-self', 'org-personal'),
    );
    // Session refresh MUST pass `{}` per nextauth-v5 foot-gun.
    await waitFor(() => expect(sessionUpdate).toHaveBeenCalledWith({}));
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/dashboard'));
  });

  it('shows STALE_MEMBERSHIPS message and refreshes session, no redirect', async () => {
    leaveOrgAction.mockResolvedValue({ ok: false, code: 'STALE_MEMBERSHIPS' });
    renderButton();

    const user = userEvent.setup();
    await user.click(screen.getByTestId('leave-org-button'));
    await user.click(await screen.findByTestId('leave-org-dialog-confirm'));

    const err = await screen.findByTestId('leave-org-dialog-error');
    expect(err.textContent).toMatch(/out of date/i);
    expect(sessionUpdate).toHaveBeenCalledWith({});
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it('shows PERSONAL_ORG_UNREMOVABLE message and does not navigate', async () => {
    leaveOrgAction.mockResolvedValue({ ok: false, code: 'PERSONAL_ORG_UNREMOVABLE' });
    renderButton();

    const user = userEvent.setup();
    await user.click(screen.getByTestId('leave-org-button'));
    await user.click(await screen.findByTestId('leave-org-dialog-confirm'));

    const err = await screen.findByTestId('leave-org-dialog-error');
    expect(err.textContent).toMatch(/personal organization/i);
    expect(sessionUpdate).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it('cancel closes the dialog without calling the action', async () => {
    renderButton();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('leave-org-button'));
    const dialog = await screen.findByTestId('leave-org-dialog');
    expect(dialog).toBeTruthy();
    // Click the Cancel button (ghost variant) — first button in footer.
    const cancelBtn = within(dialog).getByText('Cancel');
    await user.click(cancelBtn);

    expect(leaveOrgAction).not.toHaveBeenCalled();
  });
});
