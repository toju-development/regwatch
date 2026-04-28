/**
 * Component tests for `<OrgSwitcher>`.
 *
 * Spec: `sdd/org-membership-ux/spec` § R-Switcher scenarios:
 *   - "Single membership → disabled control"
 *   - "Two memberships → dropdown switch"
 *   - "Active org highlighted"
 *   - "Create-new-org affordance"
 *
 * Mocks:
 *   - `next-auth/react` `useSession` → `{ update: vi.fn() }` so the
 *     component can call `update()` after createOrgAction without
 *     needing a real `<SessionProvider>`.
 *   - `./actions` server actions are stubbed via `vi.mock` so we
 *     assert the wiring (input → action call) without hitting fetch.
 *
 * Note on Radix dropdowns in jsdom: `<DropdownMenuContent>` uses a
 * portal and pointer-event detection. Triggering `click` works fine for
 * the trigger, but the items render in a portal — `screen.findByTestId`
 * resolves them once Radix has mounted them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useActiveOrg } from '@/lib/active-org-store';

const switchActiveOrg = vi.fn();
const createOrgAction = vi.fn();
const sessionUpdate = vi.fn();

vi.mock('../actions.js', () => ({
  switchActiveOrg: (...args: unknown[]) => switchActiveOrg(...args),
  createOrgAction: (...args: unknown[]) => createOrgAction(...args),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ update: sessionUpdate, data: null, status: 'authenticated' }),
}));

// Imported AFTER mocks are registered.
import { OrgSwitcher } from '../org-switcher.js';

function hydrate(opts: {
  memberships: Array<{ organizationId: string; orgSlug: string; role: 'OWNER' | 'ADMIN' }>;
  activeOrgId: string | null;
}): void {
  const s = useActiveOrg.getState();
  s.reset();
  s.setMemberships(opts.memberships);
  s.setActive(opts.activeOrgId);
  s.markHydrated();
}

beforeEach(() => {
  switchActiveOrg.mockReset();
  createOrgAction.mockReset();
  sessionUpdate.mockReset();
});

afterEach(() => {
  useActiveOrg.getState().reset();
});

describe('<OrgSwitcher>', () => {
  it('renders a disabled trigger for a single membership', () => {
    hydrate({
      memberships: [{ organizationId: 'org-1', orgSlug: 'acme', role: 'OWNER' }],
      activeOrgId: 'org-1',
    });

    render(<OrgSwitcher />);

    const trigger = screen.getByTestId('org-switcher-trigger');
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent('acme');
    expect(trigger).toHaveAttribute('title', expect.stringMatching(/single organization/i));
  });

  it('lists all memberships and highlights the active one', async () => {
    hydrate({
      memberships: [
        { organizationId: 'org-1', orgSlug: 'acme', role: 'OWNER' },
        { organizationId: 'org-2', orgSlug: 'globex', role: 'ADMIN' },
      ],
      activeOrgId: 'org-2',
    });

    const user = userEvent.setup();
    render(<OrgSwitcher />);

    await user.click(screen.getByTestId('org-switcher-trigger'));

    const acme = await screen.findByTestId('org-switcher-item-org-1');
    const globex = await screen.findByTestId('org-switcher-item-org-2');
    expect(acme).toHaveTextContent('acme');
    expect(globex).toHaveTextContent('globex');
    expect(globex).toHaveAttribute('data-active', 'true');
    expect(acme).toHaveAttribute('data-active', 'false');
  });

  it('calls switchActiveOrg when a non-active item is selected', async () => {
    switchActiveOrg.mockResolvedValue({ ok: true });
    hydrate({
      memberships: [
        { organizationId: 'org-1', orgSlug: 'acme', role: 'OWNER' },
        { organizationId: 'org-2', orgSlug: 'globex', role: 'ADMIN' },
      ],
      activeOrgId: 'org-1',
    });

    const user = userEvent.setup();
    render(<OrgSwitcher />);

    await user.click(screen.getByTestId('org-switcher-trigger'));
    const target = await screen.findByTestId('org-switcher-item-org-2');
    await user.click(target);

    await waitFor(() => expect(switchActiveOrg).toHaveBeenCalledWith('org-2'));
    // Optimistic mirror should have flipped the store.
    expect(useActiveOrg.getState().activeOrgId).toBe('org-2');
  });

  it('does not call switchActiveOrg when the already-active row is selected', async () => {
    hydrate({
      memberships: [
        { organizationId: 'org-1', orgSlug: 'acme', role: 'OWNER' },
        { organizationId: 'org-2', orgSlug: 'globex', role: 'ADMIN' },
      ],
      activeOrgId: 'org-1',
    });

    const user = userEvent.setup();
    render(<OrgSwitcher />);

    await user.click(screen.getByTestId('org-switcher-trigger'));
    const same = await screen.findByTestId('org-switcher-item-org-1');
    await user.click(same);

    expect(switchActiveOrg).not.toHaveBeenCalled();
  });

  it('creates an org, refreshes the session, and switches to it', async () => {
    createOrgAction.mockResolvedValue({
      ok: true,
      org: { id: 'org-new', name: 'New Co', slug: 'new-co' },
    });
    switchActiveOrg.mockResolvedValue({ ok: true });

    hydrate({
      memberships: [
        { organizationId: 'org-1', orgSlug: 'acme', role: 'OWNER' },
        { organizationId: 'org-2', orgSlug: 'globex', role: 'ADMIN' },
      ],
      activeOrgId: 'org-1',
    });

    const user = userEvent.setup();
    render(<OrgSwitcher />);

    await user.click(screen.getByTestId('org-switcher-trigger'));
    const createTrigger = await screen.findByTestId('org-switcher-create');
    await user.click(createTrigger);

    const nameInput = await screen.findByTestId('org-switcher-create-name');
    await user.type(nameInput, 'New Co');

    const form = screen.getByTestId('org-switcher-create-form');
    fireEvent.submit(form);

    await waitFor(() => expect(createOrgAction).toHaveBeenCalledWith('New Co'));
    await waitFor(() => expect(sessionUpdate).toHaveBeenCalled());
    await waitFor(() => expect(switchActiveOrg).toHaveBeenCalledWith('org-new'));

    // NOTE: the new membership is NOT mirrored into the store here.
    // That used to happen via a manual `setMemberships([...])` workaround
    // but B6 removed it — the propagation is now the responsibility of
    // `<ActiveOrgProvider>`'s reactive `useSession()` sync (covered by
    // its own tests). In this unit test useSession is mocked at the
    // module level so there's no provider in the tree to observe.
  });

  it('surfaces an error when createOrgAction fails', async () => {
    createOrgAction.mockResolvedValue({ ok: false, error: 'name must be 1-80 chars' });

    hydrate({
      memberships: [
        { organizationId: 'org-1', orgSlug: 'acme', role: 'OWNER' },
        { organizationId: 'org-2', orgSlug: 'globex', role: 'ADMIN' },
      ],
      activeOrgId: 'org-1',
    });

    const user = userEvent.setup();
    render(<OrgSwitcher />);

    await user.click(screen.getByTestId('org-switcher-trigger'));
    await user.click(await screen.findByTestId('org-switcher-create'));

    const nameInput = await screen.findByTestId('org-switcher-create-name');
    await user.type(nameInput, 'New Co');
    fireEvent.submit(screen.getByTestId('org-switcher-create-form'));

    const error = await screen.findByTestId('org-switcher-create-error');
    expect(within(error).getByText(/1-80 chars/)).toBeInTheDocument();
    expect(switchActiveOrg).not.toHaveBeenCalled();
  });
});
