/**
 * Component tests for `<MemberRow>`.
 *
 * Spec: `sdd/org-members/spec`
 *   - R-Membership-Update (role change matrix; optimistic UI).
 *   - R-Membership-Remove (admin-removes-other dialog flow).
 *
 * Mocks: server actions are stubbed via `vi.mock('../actions.js')`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const updateMemberRoleAction = vi.fn();
const removeMemberAction = vi.fn();

vi.mock('../actions.js', () => ({
  updateMemberRoleAction: (...a: unknown[]) => updateMemberRoleAction(...a),
  removeMemberAction: (...a: unknown[]) => removeMemberAction(...a),
}));

import { MemberRow, type MemberRowData } from '../member-row.js';

const baseMember: MemberRowData = {
  userId: 'user-2',
  email: 'bob@example.com',
  name: 'Bob',
  role: 'ANALYST',
  joinedAt: '2025-01-15T00:00:00.000Z',
  isPersonalOrgOwner: false,
};

function renderRow(
  overrides: Partial<{
    member: MemberRowData;
    isSelf: boolean;
    canManage: boolean;
  }> = {},
): void {
  const member = overrides.member ?? baseMember;
  render(
    <table>
      <tbody>
        <MemberRow
          orgId="org-1"
          member={member}
          isSelf={overrides.isSelf ?? false}
          canManage={overrides.canManage ?? true}
          viewerRole="OWNER"
        />
      </tbody>
    </table>,
  );
}

beforeEach(() => {
  updateMemberRoleAction.mockReset();
  removeMemberAction.mockReset();
});

afterEach(() => {
  // no-op
});

describe('<MemberRow> role change', () => {
  it('paints optimistic role and calls action on selection', async () => {
    updateMemberRoleAction.mockResolvedValue({ ok: true });
    renderRow();

    const user = userEvent.setup();
    await user.click(screen.getByTestId('member-row-role-trigger-user-2'));
    const adminItem = await screen.findByTestId('member-row-role-option-user-2-ADMIN');
    await user.click(adminItem);

    await waitFor(() =>
      expect(updateMemberRoleAction).toHaveBeenCalledWith('org-1', 'user-2', 'ADMIN'),
    );
  });

  it('rolls back optimistic role and surfaces error on rejection', async () => {
    updateMemberRoleAction.mockResolvedValue({
      ok: false,
      code: 'OWNER_PROMOTE_REQUIRES_OWNER',
      error: 'no',
    });
    renderRow();

    const user = userEvent.setup();
    await user.click(screen.getByTestId('member-row-role-trigger-user-2'));
    const ownerItem = await screen.findByTestId('member-row-role-option-user-2-OWNER');
    await user.click(ownerItem);

    const errorEl = await screen.findByTestId('member-row-error-user-2');
    expect(errorEl.textContent).toMatch(/Only an OWNER can promote/i);
    // Trigger label rolled back to the original role.
    expect(screen.getByTestId('member-row-role-trigger-user-2').textContent).toBe('ANALYST');
  });

  it('does NOT fire action when picking the current role', async () => {
    renderRow();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('member-row-role-trigger-user-2'));
    const same = await screen.findByTestId('member-row-role-option-user-2-ANALYST');
    await user.click(same);
    expect(updateMemberRoleAction).not.toHaveBeenCalled();
  });
});

describe('<MemberRow> remove flow', () => {
  it('hides the kebab on the self row', () => {
    renderRow({ isSelf: true });
    expect(screen.queryByTestId('member-row-menu-user-2')).toBeNull();
  });

  it('hides the kebab when the viewer cannot manage', () => {
    renderRow({ canManage: false });
    expect(screen.queryByTestId('member-row-menu-user-2')).toBeNull();
  });

  it('opens the remove dialog and calls removeMemberAction on confirm', async () => {
    removeMemberAction.mockResolvedValue({ ok: true });
    renderRow();

    const user = userEvent.setup();
    await user.click(screen.getByTestId('member-row-menu-user-2'));
    const trigger = await screen.findByTestId('member-row-remove-trigger-user-2');
    await user.click(trigger);

    const confirm = await screen.findByTestId('remove-member-dialog-confirm-user-2');
    await user.click(confirm);

    await waitFor(() => expect(removeMemberAction).toHaveBeenCalledWith('org-1', 'user-2'));
  });

  it('keeps the dialog open and shows an error on LAST_OWNER', async () => {
    removeMemberAction.mockResolvedValue({ ok: false, code: 'LAST_OWNER' });
    renderRow();

    const user = userEvent.setup();
    await user.click(screen.getByTestId('member-row-menu-user-2'));
    await user.click(await screen.findByTestId('member-row-remove-trigger-user-2'));
    await user.click(await screen.findByTestId('remove-member-dialog-confirm-user-2'));

    const err = await screen.findByTestId('remove-member-dialog-error-user-2');
    expect(err.textContent).toMatch(/last OWNER/i);
  });
});
