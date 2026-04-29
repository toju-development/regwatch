/**
 * Route handler tests for `POST /api/invitations/[token]/accept` (AUTHED PROXY).
 *
 * Spec: `sdd/org-invitations/spec` § R-Invitation-Accept.
 * Design: `sdd/org-invitations/design` §0 D7 + §2 (data flow critical path).
 *
 * Anchors:
 *   - 401 short-circuits without contacting upstream when no session cookie
 *     (matches authed-proxy convention; the upstream `JwtAuthGuard` would
 *      return 401 anyway — saves a hop).
 *   - JWT IS forwarded as Authorization: Bearer <cookie> (route is authed
 *     even though decorated `@PublicScope()` upstream — JWT must validate).
 *   - X-Org-Id is NOT required (accept is org-creation, not org-scoped) but
 *     the helper forwards it conditionally if a stale header rides along.
 *   - 401 STALE_MEMBERSHIPS body pipes through unchanged so client-side
 *     `apiFetch` can do its single-retry dance after `session.update({})`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from '../route.js';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('API_URL', 'http://api.test');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function acceptReq(opts: { cookie?: string; orgId?: string } = {}): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.cookie) headers.cookie = `authjs.session-token=${opts.cookie}`;
  if (opts.orgId) headers['x-org-id'] = opts.orgId;
  return new NextRequest('http://localhost:3000/api/invitations/some-token/accept', {
    method: 'POST',
    headers,
    body: '',
  });
}

describe('POST /api/invitations/[token]/accept (authed proxy)', () => {
  it('returns 401 without contacting upstream when no session cookie', async () => {
    const res = await POST(acceptReq(), { params: Promise.resolve({ token: 'tk' }) });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards JWT as Authorization Bearer and pipes 200 {orgId, role}', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ orgId: 'org-1', role: 'ANALYST' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await POST(acceptReq({ cookie: 'JWT_VALUE' }), {
      params: Promise.resolve({ token: 'some-token' }),
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/invitations/some-token/accept');
    expect((init as { method: string }).method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer JWT_VALUE');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { orgId: string; role: string };
    expect(body).toEqual({ orgId: 'org-1', role: 'ANALYST' });
  });

  it('URL-encodes the token path segment', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ orgId: 'o', role: 'VIEWER' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await POST(acceptReq({ cookie: 'JWT' }), { params: Promise.resolve({ token: 'a/b' }) });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/invitations/a%2Fb/accept');
  });

  it('pipes 401 STALE_MEMBERSHIPS through unchanged so apiFetch can retry', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'STALE_MEMBERSHIPS' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await POST(acceptReq({ cookie: 'JWT' }), {
      params: Promise.resolve({ token: 'tk' }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('STALE_MEMBERSHIPS');
  });

  it('pipes 403 EMAIL_MISMATCH through unchanged', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'EMAIL_MISMATCH' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await POST(acceptReq({ cookie: 'JWT' }), {
      params: Promise.resolve({ token: 'tk' }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('EMAIL_MISMATCH');
  });

  it('pipes 410 INVITATION_REVOKED through unchanged', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'INVITATION_REVOKED' }), {
        status: 410,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await POST(acceptReq({ cookie: 'JWT' }), {
      params: Promise.resolve({ token: 'tk' }),
    });
    expect(res.status).toBe(410);
  });
});
