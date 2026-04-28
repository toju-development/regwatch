/**
 * Component tests for `<ActiveOrgProvider>`.
 *
 * Spec: `sdd/org-membership-ux/spec`
 *   - § R-Switcher (provider supplies the data the switcher renders).
 *   - § R-ApiFetch (the `hydrated` flag this provider flips is the
 *     gate `apiFetch` reads before attaching `X-Org-Id`).
 *   - § R-Jwt-Refresh-OnSelfCreate ("any UI surface MUST see the
 *     refreshed memberships" — locked in by the reactive-sync tests
 *     below).
 *
 * Design: §4 + §6 + decision #5 ("Hybrid: RSC seeds, client mirrors").
 *
 * What this proves:
 *   - On mount, the provider seeds `memberships`, `activeOrgId`, and
 *     flips `hydrated` to `true` in the Zustand store.
 *   - Children render unconditionally (no Suspense / no gate at this
 *     layer — `apiFetch` enforces the gate downstream).
 *   - When parent props change (RSC re-render after a server action +
 *     `revalidatePath('/', 'layout')`) the store re-seeds without
 *     losing `hydrated=true`.
 *   - **Reactive session sync**: when `useSession().data.user.memberships`
 *     mutates (e.g. after `session.update()` rotates the JWT claim),
 *     the store re-seeds memberships WITHOUT a prop change. This is
 *     the contract that lets the dashboard, future members page, and
 *     any other surface see fresh data without a hard reload. See
 *     foot-gun `regwatch/footguns/active-org-provider-needs-reactive-session-sync`.
 *   - The reactive sync is GATED on `status === 'authenticated'` so
 *     the initial `loading` phase doesn't blank out the prop-seeded
 *     memberships.
 *
 * Notes:
 *   - We import `useActiveOrg` directly to assert against `getState()`
 *     (Zustand 5 exposes the store handle on the hook itself — no
 *     `createStore` from `zustand/vanilla` needed; see B3 discovery).
 *   - `reset()` is the test-only action exposed by the store; we call
 *     it in `beforeEach` so suites don't bleed.
 *   - `next-auth/react`'s `useSession` is module-mocked. Tests that
 *     need to mutate the session call `setMockSession({ ... })` and
 *     then re-render — the mock reads from the closure on every call.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { MembershipClaim } from '@regwatch/types';

import { useActiveOrg } from '@/lib/active-org-store';

// ── Mutable mock for useSession. Tests reassign `mockSession` and the
//    factory returns the latest reference on every call.
type MockSession = {
  data: { user?: { memberships?: MembershipClaim[] } } | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
};

let mockSession: MockSession = { data: null, status: 'loading' };

function setMockSession(next: MockSession): void {
  mockSession = next;
}

vi.mock('next-auth/react', () => ({
  useSession: () => mockSession,
}));

// Imported AFTER mocks are registered.
import { ActiveOrgProvider } from '../active-org-provider.js';

const memberships: ReadonlyArray<MembershipClaim> = [
  { organizationId: 'org-a', orgSlug: 'a', role: 'OWNER' },
  { organizationId: 'org-b', orgSlug: 'b', role: 'ADMIN' },
];

beforeEach(() => {
  useActiveOrg.getState().reset();
  setMockSession({ data: null, status: 'loading' });
});

describe('<ActiveOrgProvider>', () => {
  it('seeds memberships and activeOrgId, flips hydrated=true on mount', () => {
    render(
      <ActiveOrgProvider memberships={memberships} activeOrgId="org-b">
        <div data-testid="child">child</div>
      </ActiveOrgProvider>,
    );

    const s = useActiveOrg.getState();
    expect(s.memberships).toEqual(memberships);
    expect(s.activeOrgId).toBe('org-b');
    expect(s.hydrated).toBe(true);
  });

  it('renders children unconditionally (no gate at this layer)', () => {
    render(
      <ActiveOrgProvider memberships={memberships} activeOrgId="org-a">
        <div data-testid="child">child-content</div>
      </ActiveOrgProvider>,
    );
    expect(screen.getByTestId('child')).toHaveTextContent('child-content');
  });

  it('handles empty memberships + null activeOrgId without throwing', () => {
    render(
      <ActiveOrgProvider memberships={[]} activeOrgId={null}>
        <div data-testid="child">x</div>
      </ActiveOrgProvider>,
    );

    const s = useActiveOrg.getState();
    expect(s.memberships).toEqual([]);
    expect(s.activeOrgId).toBeNull();
    expect(s.hydrated).toBe(true);
  });

  it('re-seeds the store when parent props change (RSC re-render path)', () => {
    const { rerender } = render(
      <ActiveOrgProvider memberships={memberships} activeOrgId="org-a">
        <div>x</div>
      </ActiveOrgProvider>,
    );
    expect(useActiveOrg.getState().activeOrgId).toBe('org-a');

    const next: ReadonlyArray<MembershipClaim> = [
      ...memberships,
      { organizationId: 'org-c', orgSlug: 'c', role: 'VIEWER' },
    ];
    rerender(
      <ActiveOrgProvider memberships={next} activeOrgId="org-c">
        <div>x</div>
      </ActiveOrgProvider>,
    );

    const s = useActiveOrg.getState();
    expect(s.memberships).toHaveLength(3);
    expect(s.activeOrgId).toBe('org-c');
    expect(s.hydrated).toBe(true);
  });

  // ── Reactive session-sync tests (the bug Option B fixes).

  it('does NOT blank out prop-seeded memberships during loading status', () => {
    setMockSession({ data: null, status: 'loading' });

    render(
      <ActiveOrgProvider memberships={memberships} activeOrgId="org-a">
        <div>x</div>
      </ActiveOrgProvider>,
    );

    expect(useActiveOrg.getState().memberships).toEqual(memberships);
  });

  it('mirrors useSession().data.user.memberships into the store when it changes', () => {
    // Initial mount: status=authenticated but session memberships match props.
    setMockSession({
      data: { user: { memberships: [...memberships] } },
      status: 'authenticated',
    });

    const { rerender } = render(
      <ActiveOrgProvider memberships={memberships} activeOrgId="org-a">
        <div>x</div>
      </ActiveOrgProvider>,
    );
    expect(useActiveOrg.getState().memberships).toHaveLength(2);

    // Simulate `session.update()` rotating the JWT claim — a 3rd org
    // appeared on the session WITHOUT the parent re-rendering with new
    // props. The reactive sync MUST mirror this into the store.
    const refreshed: MembershipClaim[] = [
      ...memberships,
      { organizationId: 'org-new', orgSlug: 'new-co', role: 'OWNER' },
    ];
    act(() => {
      setMockSession({
        data: { user: { memberships: refreshed } },
        status: 'authenticated',
      });
    });
    rerender(
      <ActiveOrgProvider memberships={memberships} activeOrgId="org-a">
        <div>x</div>
      </ActiveOrgProvider>,
    );

    const s = useActiveOrg.getState();
    expect(s.memberships).toHaveLength(3);
    expect(s.memberships.map((m) => m.organizationId)).toContain('org-new');
  });

  it('ignores session updates that lack a memberships array (no-op)', () => {
    setMockSession({
      data: { user: {} },
      status: 'authenticated',
    });

    render(
      <ActiveOrgProvider memberships={memberships} activeOrgId="org-a">
        <div>x</div>
      </ActiveOrgProvider>,
    );

    // Prop-seeded memberships preserved (the session-sync effect
    // guards on `sessionMemberships !== null`).
    expect(useActiveOrg.getState().memberships).toHaveLength(2);
  });
});
