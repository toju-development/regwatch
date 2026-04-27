/**
 * Route handler tests for `POST /api/org/switch`.
 *
 * Spec: `sdd/org-membership-ux/spec` § R-ActiveOrgCookie:
 *   - "Two memberships → dropdown switch" → 204 + cookie set
 *   - "Cookie is HttpOnly" → Set-Cookie attributes
 * Design: §3 (cookie strategy) + §4 (switcher action).
 *
 * The handler is web-only (no proxy hop). It calls `auth()` to read the
 * session memberships, validates the requested orgId, and writes the
 * HttpOnly active-org cookie. We mock `@/lib/auth` so we can flip the
 * session shape per case without touching NextAuth internals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({
  auth: () => authMock(),
}));

import { POST } from '../route.js';

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/org/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authMock.mockReset();
  // Force dev cookie name so assertions can match without env stubs.
  vi.stubEnv('NODE_ENV', 'development');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/org/switch', () => {
  it('returns 401 when there is no session', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(makeReq({ orgId: 'org-1' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid body shape', async () => {
    authMock.mockResolvedValue({
      user: { memberships: [{ organizationId: 'org-1', orgSlug: 'a', role: 'OWNER' }] },
    });
    const res = await POST(makeReq({ wrongKey: 'x' }));
    expect(res.status).toBe(400);
  });

  it('returns 403 when orgId is not in memberships', async () => {
    authMock.mockResolvedValue({
      user: { memberships: [{ organizationId: 'org-1', orgSlug: 'a', role: 'OWNER' }] },
    });
    const res = await POST(makeReq({ orgId: 'org-other' }));
    expect(res.status).toBe(403);
  });

  it('returns 204 + sets HttpOnly cookie on success', async () => {
    authMock.mockResolvedValue({
      user: {
        memberships: [
          { organizationId: 'org-1', orgSlug: 'acme', role: 'OWNER' },
          { organizationId: 'org-2', orgSlug: 'globex', role: 'ADMIN' },
        ],
      },
    });

    const res = await POST(makeReq({ orgId: 'org-2' }));
    expect(res.status).toBe(204);

    // The cookie is set on the NextResponse — verify via cookies API.
    const cookie = res.cookies.get('regwatch.active-org');
    expect(cookie?.value).toBe('org-2');

    // Verify the raw Set-Cookie header carries HttpOnly + SameSite=Lax.
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/regwatch\.active-org=org-2/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
  });
});
