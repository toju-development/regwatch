/**
 * Component tests for `<ActiveOrgProvider>`.
 *
 * Spec: `sdd/org-membership-ux/spec`
 *   - § R-Switcher (provider supplies the data the switcher renders).
 *   - § R-ApiFetch (the `hydrated` flag this provider flips is the
 *     gate `apiFetch` reads before attaching `X-Org-Id`).
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
 *
 * Notes:
 *   - We import `useActiveOrg` directly to assert against `getState()`
 *     (Zustand 5 exposes the store handle on the hook itself — no
 *     `createStore` from `zustand/vanilla` needed; see B3 discovery).
 *   - `reset()` is the test-only action exposed by the store; we call
 *     it in `beforeEach` so suites don't bleed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MembershipClaim } from '@regwatch/types';

import { useActiveOrg } from '@/lib/active-org-store';
import { ActiveOrgProvider } from '../active-org-provider.js';

const memberships: ReadonlyArray<MembershipClaim> = [
  { organizationId: 'org-a', orgSlug: 'a', role: 'OWNER' },
  { organizationId: 'org-b', orgSlug: 'b', role: 'ADMIN' },
];

beforeEach(() => {
  useActiveOrg.getState().reset();
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
});
