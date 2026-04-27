/**
 * @vitest-environment node
 *
 * Contract test for the NextAuth `events.signOut` hook side effect.
 *
 * Spec: `sdd/org-membership-ux/spec` § R-ActiveOrgCookie scenario
 *   "Sign-out clears cookie": the active-org cookie MUST be deleted
 *   in the same response that clears the NextAuth session cookie.
 *
 * The `events.signOut` handler in `auth.ts` is wired to
 * `clearActiveOrgOnSignOut` (extracted to `auth-signout.ts` for
 * testability — booting the full NextAuth instance would require env
 * validation, Prisma, providers, etc., which is out of scope for a
 * focused contract test).
 *
 * Environment: `node`, because `next/headers` is server-only and throws
 * under jsdom (per `regwatch/footguns/jose-jsdom-incompat` family).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const cookieStoreDelete = vi.fn();
const cookieStoreGet = vi.fn();
const cookieStoreSet = vi.fn();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: cookieStoreGet,
    set: cookieStoreSet,
    delete: cookieStoreDelete,
  }),
}));

import { clearActiveOrgOnSignOut } from '../auth-signout.js';
import { getActiveOrgCookieName } from '../active-org-cookie.js';

beforeEach(() => {
  cookieStoreDelete.mockReset();
  cookieStoreGet.mockReset();
  cookieStoreSet.mockReset();
});

describe('clearActiveOrgOnSignOut', () => {
  it('deletes the active-org cookie by its environment-resolved name', async () => {
    await clearActiveOrgOnSignOut();
    expect(cookieStoreDelete).toHaveBeenCalledTimes(1);
    expect(cookieStoreDelete).toHaveBeenCalledWith(getActiveOrgCookieName());
  });

  it('honours NODE_ENV at call time (prod uses __Secure- prefix)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      await clearActiveOrgOnSignOut();
      expect(cookieStoreDelete).toHaveBeenCalledWith('__Secure-regwatch.active-org');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('uses the dev cookie name when NODE_ENV !== production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    try {
      await clearActiveOrgOnSignOut();
      expect(cookieStoreDelete).toHaveBeenCalledWith('regwatch.active-org');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
