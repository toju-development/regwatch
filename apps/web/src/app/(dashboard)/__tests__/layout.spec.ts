/**
 * @vitest-environment node
 *
 * Unit tests para el guard de onboarding en `(dashboard)/layout.tsx`.
 *
 * Nuevo comportamiento (post-redesign):
 *   - OWNER + onboardingCompletedAt === null → renderiza <OnboardingModal> (NO redirige)
 *   - OWNER + onboardingCompletedAt set → no modal; renderiza normalmente
 *   - Non-OWNER (ANALYST / ADMIN) → no modal; apiServerFetch NOT called
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
vi.mock('@/components/auth/logout-button', () => ({ LogoutButton: () => null }));
vi.mock('@/components/onboarding/onboarding-modal', () => ({
  OnboardingModal: vi.fn(() => null),
}));

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
    json: () =>
      Promise.resolve({
        settings: {
          onboardingCompletedAt,
          jurisdictions: [],
          scanSchedule: 'weekly',
          scanDay: 'mon',
          scanHour: 8,
        },
      }),
  };
}

function channelsJson() {
  return {
    ok: true,
    json: () => Promise.resolve([]),
  };
}

function orgMeJson(orgName = 'Mi Org') {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        memberships: [
          { orgId: 'org-1', orgName, orgSlug: 'my-org', role: 'OWNER', isPersonal: false },
        ],
        activeOrgId: 'org-1',
      }),
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

describe('DashboardLayout — onboarding guard', () => {
  it('NO redirige al OWNER cuando onboardingCompletedAt es null — monta el modal', async () => {
    auth.mockResolvedValue(makeSession([makeMembership('OWNER')]));
    // apiServerFetch se llama 3 veces: settings, channels, org/me
    apiServerFetch
      .mockResolvedValueOnce(settingsJson(null))
      .mockResolvedValueOnce(channelsJson())
      .mockResolvedValueOnce(orgMeJson());

    const result = await DashboardLayout({ children: null });
    expect(result).toBeDefined();
    expect(redirect).not.toHaveBeenCalledWith('/onboarding');

    // Verifica que el árbol JSX incluye OnboardingModal con las props correctas.
    // En un RSC (node env) React no invoca la función del componente — inspeccionamos
    // el elemento React devuelto directamente.
    const tree = JSON.stringify(result);
    expect(tree).toContain('"orgId":"org-1"');
    expect(tree).toContain('"initialOrgName":"Mi Org"');
  });

  it('does NOT redirect OWNER when onboardingCompletedAt is set', async () => {
    auth.mockResolvedValue(makeSession([makeMembership('OWNER')]));
    apiServerFetch.mockResolvedValue(settingsJson('2026-05-09T12:00:00.000Z'));

    await expect(DashboardLayout({ children: null })).resolves.toBeDefined();
    expect(redirect).not.toHaveBeenCalledWith('/onboarding');
  });

  it('does NOT call apiServerFetch for ANALYST (no onboarding check)', async () => {
    auth.mockResolvedValue(makeSession([makeMembership('ANALYST')]));

    await expect(DashboardLayout({ children: null })).resolves.toBeDefined();
    expect(apiServerFetch).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalledWith('/onboarding');
  });

  it('does NOT call apiServerFetch for ADMIN', async () => {
    auth.mockResolvedValue(makeSession([makeMembership('ADMIN')]));

    await expect(DashboardLayout({ children: null })).resolves.toBeDefined();
    expect(apiServerFetch).not.toHaveBeenCalled();
  });

  it('redirects to /login when session is missing', async () => {
    auth.mockResolvedValue(null);

    await expect(DashboardLayout({ children: null })).rejects.toThrow('REDIRECT:/login');
    expect(redirect).toHaveBeenCalledWith('/login');
  });
});
