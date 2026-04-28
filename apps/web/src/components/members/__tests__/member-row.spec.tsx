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
import type { Role } from '@regwatch/types';

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
    viewerRole: Role;
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
          viewerRole={overrides.viewerRole ?? 'OWNER'}
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

describe('<MemberRow> viewerRole gating (UI defense-in-depth)', () => {
  // Spec: R-Membership-Update — "ADMIN MUST NOT promote anyone to OWNER".
  // Backend returns 403 OWNER_PROMOTE_REQUIRES_OWNER; UI pre-disables the
  // option so the user never picks a choice we know the server will reject.

  it('ADMIN viewer sees OWNER option disabled and cannot trigger the action', async () => {
    updateMemberRoleAction.mockResolvedValue({ ok: true });
    renderRow({ viewerRole: 'ADMIN' });

    const user = userEvent.setup();
    await user.click(screen.getByTestId('member-row-role-trigger-user-2'));

    const ownerOption = await screen.findByTestId('member-row-role-option-user-2-OWNER');
    // Radix marks disabled items via `data-disabled` (and aria); we also
    // mirror it ourselves for stable test access.
    expect(ownerOption.getAttribute('data-disabled')).toBe('true');

    await user.click(ownerOption);
    // Even if Radix lets the click through (it shouldn't), the handler
    // must be a no-op — guarded inside `handleRoleChange`.
    expect(updateMemberRoleAction).not.toHaveBeenCalled();

    // Other roles remain enabled.
    expect(
      screen.getByTestId('member-row-role-option-user-2-ADMIN').getAttribute('data-disabled'),
    ).toBe('false');
    expect(
      screen.getByTestId('member-row-role-option-user-2-VIEWER').getAttribute('data-disabled'),
    ).toBe('false');
  });

  it('OWNER viewer sees every role option enabled', async () => {
    renderRow({ viewerRole: 'OWNER' });

    const user = userEvent.setup();
    await user.click(screen.getByTestId('member-row-role-trigger-user-2'));

    for (const role of ['OWNER', 'ADMIN', 'ANALYST', 'VIEWER'] as const) {
      const opt = await screen.findByTestId(`member-row-role-option-user-2-${role}`);
      expect(opt.getAttribute('data-disabled')).toBe('false');
    }
  });
});
