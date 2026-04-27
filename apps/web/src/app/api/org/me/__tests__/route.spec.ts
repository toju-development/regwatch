/**
 * Route handler tests for `GET /api/org/me` (PROXY).
 *
 * Spec: `sdd/org-membership-ux/spec` § R-Org-GetMe.
 * Design: §1 (PROXY MODE deviation) + §6.
 *
 * Asserts:
 *   - Forwards to `${API_URL}/org/me` with `Authorization: Bearer <jwt>`
 *     reconstructed from the session cookie (server-side).
 *   - Forwards `X-Org-Id` from the inbound request when present.
 *   - Pipes upstream status, body, and Cache-Control verbatim.
 *   - Returns 401 without contacting the API when no session cookie
 *     is present.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from '../route.js';

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

function reqWithCookie(opts: { cookie?: string; orgId?: string }): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = `authjs.session-token=${opts.cookie}`;
  if (opts.orgId) headers['x-org-id'] = opts.orgId;
  return new NextRequest('http://localhost:3000/api/org/me', {
    method: 'GET',
    headers,
  });
}

describe('GET /api/org/me (proxy)', () => {
  it('returns 401 without contacting the API when no session cookie', async () => {
    const res = await GET(reqWithCookie({}));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards Authorization + X-Org-Id and pipes upstream response', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ memberships: [] }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }),
    );

    const res = await GET(reqWithCookie({ cookie: 'JWT_VALUE', orgId: 'org-1' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/org/me');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer JWT_VALUE');
    expect(headers.get('X-Org-Id')).toBe('org-1');

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toContain('memberships');
  });

  it('does not attach X-Org-Id when the inbound request omits it', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await GET(reqWithCookie({ cookie: 'JWT' }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('X-Org-Id')).toBeNull();
  });

  it('pipes upstream non-2xx status verbatim', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"x"}', { status: 502 }));

    const res = await GET(reqWithCookie({ cookie: 'JWT' }));
    expect(res.status).toBe(502);
  });
});
