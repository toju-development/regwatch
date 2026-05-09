/**
 * @vitest-environment node
 *
 * Unit tests for the onboarding redirect guard in `(dashboard)/layout.tsx`.
 *
 * Spec: `sdd/onboarding-flow/spec` — "OWNER with incomplete onboarding is redirected":
 *   - OWNER + onboardingCompletedAt === null → redirect('/onboarding')
 *   - OWNER + onboardingCompletedAt set → no redirect; renders normally
 *   - Non-OWNER (ANALYST / ADMIN) → no redirect; apiServerFetch NOT called
 *
 * Strategy: call the async RSC function directly (no jsdom). Mock all I/O
 * boundaries. `redirect` is mocked to throw so assertions use `.rejects`.
 *
 * Why node env: RSC imports server-only modules (`next/headers`,
 * `@/lib/api-server`) that don't work under jsdom.
 *
 * Why vi.hoisted: `vi.mock` is hoisted above `const` declarations; outer
 * variables referenced inside the factory would be in the temporal dead zone.
 * `vi.hoisted` runs its callback first, making the stubs available.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MembershipClaim } from '@regwatch/types';

// ---------------------------------------------------------------------- //
// Hoisted stubs — available before vi.mock factories run                  //
// ---------------------------------------------------------------------- //

const { auth, redirect, resolveActiveOrg, apiServerFetch } = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn().mockImplementation((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
  resolveActiveOrg: vi.fn(),
  apiServerFetch: vi.fn(),
}));

// ---------------------------------------------------------------------- //
// Module mocks                                                             //
// ---------------------------------------------------------------------- //

vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/active-org-resolve', () => ({ resolveActiveOrg }));
vi.mock('@/lib/api-server', () => ({ apiServerFetch }));

// React sub-tree mocks — return children/null so JSX evaluation resolves
// in node env without jsdom rendering.
vi.mock('next-auth/react', () => ({
  SessionProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('@/components/org-switcher/active-org-provider', () => ({
  ActiveOrgProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('@/components/org-switcher/org-switcher', () => ({ OrgSwitcher: () => null }));
vi.mock('@/components/dashboard/nav-links', () => ({ NavLinks: () => null }));

import DashboardLayout from '../layout.js';

// ---------------------------------------------------------------------- //
// Helpers                                                                  //
// ---------------------------------------------------------------------- //

function makeSession(memberships: MembershipClaim[]) {
  return { user: { memberships } };
}

function makeMembership(role: MembershipClaim['role']): MembershipClaim {
  return { organizationId: 'org-1', orgSlug: 'my-org', role };
}

function settingsJson(onboardingCompletedAt: string | null) {
  return {
    ok: true,
    json: () => Promise.resolve({ settings: { onboardingCompletedAt } }),
  };
}

// ---------------------------------------------------------------------- //
// Tests                                                                    //
// ---------------------------------------------------------------------- //

beforeEach(() => {
  auth.mockReset();
  redirect.mockClear();
  resolveActiveOrg.mockReset();
  apiServerFetch.mockReset();
  // Restore throw behaviour cleared by mockReset/mockClear.
  redirect.mockImplementation((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  });
  resolveActiveOrg.mockResolvedValue({ activeOrgId: 'org-1' });
});

describe('DashboardLayout — onboarding redirect guard', () => {
  it('redirects OWNER to /onboarding when onboardingCompletedAt is null', async () => {
    auth.mockResolvedValue(makeSession([makeMembership('OWNER')]));
    apiServerFetch.mockResolvedValue(settingsJson(null));

    await expect(DashboardLayout({ children: null })).rejects.toThrow('REDIRECT:/onboarding');
    expect(redirect).toHaveBeenCalledWith('/onboarding');
  });

  it('does NOT redirect OWNER when onboardingCompletedAt is set', async () => {
    auth.mockResolvedValue(makeSession([makeMembership('OWNER')]));
    apiServerFetch.mockResolvedValue(settingsJson('2026-05-09T12:00:00.000Z'));

    await expect(DashboardLayout({ children: null })).resolves.toBeDefined();
    expect(redirect).not.toHaveBeenCalledWith('/onboarding');
  });

  it('does NOT redirect ANALYST even when org has null onboardingCompletedAt', async () => {
    auth.mockResolvedValue(makeSession([makeMembership('ANALYST')]));

    await expect(DashboardLayout({ children: null })).resolves.toBeDefined();
    // Non-OWNER: the guard must skip the settings fetch entirely.
    expect(apiServerFetch).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalledWith('/onboarding');
  });

  it('does NOT redirect ADMIN even when org has null onboardingCompletedAt', async () => {
    auth.mockResolvedValue(makeSession([makeMembership('ADMIN')]));

    await expect(DashboardLayout({ children: null })).resolves.toBeDefined();
    expect(apiServerFetch).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalledWith('/onboarding');
  });

  it('redirects to /login when session is missing', async () => {
    auth.mockResolvedValue(null);

    await expect(DashboardLayout({ children: null })).rejects.toThrow('REDIRECT:/login');
    expect(redirect).toHaveBeenCalledWith('/login');
  });
});
