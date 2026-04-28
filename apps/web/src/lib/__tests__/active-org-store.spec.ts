/**
 * Spec: `sdd/org-membership-ux/spec` § R-Switcher / R-ApiFetch — store
 *   acceptance criteria covered by `api-fetch.spec.ts`. This file
 *   covers the store contract directly: shape, action mutations,
 *   `getState()` outside React, `reset()` semantics.
 *
 * Design §4 + §6.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { MembershipClaim } from '@regwatch/types';

import { useActiveOrg } from '../active-org-store.js';

const m = (organizationId: string): MembershipClaim => ({
  organizationId,
  orgSlug: organizationId,
  role: 'OWNER',
});

afterEach(() => {
  useActiveOrg.getState().reset();
});

describe('useActiveOrg — initial state', () => {
  it('starts unhydrated, with no active org and no memberships', () => {
    const s = useActiveOrg.getState();
    expect(s.hydrated).toBe(false);
    expect(s.activeOrgId).toBeNull();
    expect(s.memberships).toEqual([]);
  });
});

describe('useActiveOrg — actions (vanilla getState/setState)', () => {
  it('setMemberships replaces the memberships list', () => {
    useActiveOrg.getState().setMemberships([m('org-a'), m('org-b')]);
    expect(useActiveOrg.getState().memberships).toEqual([m('org-a'), m('org-b')]);
  });

  it('setActive updates activeOrgId and accepts null', () => {
    useActiveOrg.getState().setActive('org-a');
    expect(useActiveOrg.getState().activeOrgId).toBe('org-a');
    useActiveOrg.getState().setActive(null);
    expect(useActiveOrg.getState().activeOrgId).toBeNull();
  });

  it('markHydrated flips hydrated to true (idempotent)', () => {
    useActiveOrg.getState().markHydrated();
    expect(useActiveOrg.getState().hydrated).toBe(true);
    useActiveOrg.getState().markHydrated();
    expect(useActiveOrg.getState().hydrated).toBe(true);
  });

  it('reset restores initial state', () => {
    const s = useActiveOrg.getState();
    s.setMemberships([m('org-a')]);
    s.setActive('org-a');
    s.markHydrated();

    s.reset();

    const after = useActiveOrg.getState();
    expect(after.hydrated).toBe(false);
    expect(after.activeOrgId).toBeNull();
    expect(after.memberships).toEqual([]);
  });
});
