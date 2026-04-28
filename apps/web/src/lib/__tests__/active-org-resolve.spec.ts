/**
 * Spec: `sdd/org-membership-ux/spec`
 *   - R-ActiveOrgCookie scenarios "Cookie absent" + "Cookie points to revoked".
 * Design: §3 + §8 + decision #4.
 *
 * Pure-function tests for `pickDefault`. `resolveActiveOrg` is tested
 * with a mocked `next/headers` cookie store (no real Next runtime).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MembershipClaim } from '@regwatch/types';

import { pickDefault } from '../active-org-resolve.js';

const m = (organizationId: string, role: MembershipClaim['role'] = 'OWNER'): MembershipClaim => ({
  organizationId,
  orgSlug: organizationId,
  role,
});

describe('pickDefault', () => {
  it('returns null on empty memberships', () => {
    expect(pickDefault([])).toBeNull();
  });

  it('picks the first membership when single', () => {
    expect(pickDefault([m('org-personal')])).toBe('org-personal');
  });

  it('picks the first membership in JWT order (creation order = personal first)', () => {
    expect(pickDefault([m('org-personal'), m('org-team-a'), m('org-team-b')])).toBe('org-personal');
  });
});

describe('resolveActiveOrg', () => {
  const memberships = [m('org-personal'), m('org-team-a'), m('org-team-b')];

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('next/headers');
  });

  async function loadWithCookie(value: string | null) {
    vi.doMock('next/headers', () => ({
      cookies: async () => ({
        get: (name: string) =>
          value !== null && name === 'regwatch.active-org' ? { name, value } : undefined,
      }),
    }));
    const mod = await import('../active-org-resolve.js');
    return mod.resolveActiveOrg;
  }

  it('returns the cookie value when it matches a membership', async () => {
    const resolveActiveOrg = await loadWithCookie('org-team-a');
    const out = await resolveActiveOrg(memberships);
    expect(out.activeOrgId).toBe('org-team-a');
    expect(out.memberships).toBe(memberships);
  });

  it('falls back to default when cookie is absent', async () => {
    const resolveActiveOrg = await loadWithCookie(null);
    const out = await resolveActiveOrg(memberships);
    expect(out.activeOrgId).toBe('org-personal');
  });

  it('falls back to default when cookie points to a revoked membership', async () => {
    const resolveActiveOrg = await loadWithCookie('org-removed');
    const out = await resolveActiveOrg(memberships);
    expect(out.activeOrgId).toBe('org-personal');
  });

  it('returns null when memberships is empty (regardless of cookie)', async () => {
    const resolveActiveOrg = await loadWithCookie('org-anything');
    const out = await resolveActiveOrg([]);
    expect(out.activeOrgId).toBeNull();
  });
});
