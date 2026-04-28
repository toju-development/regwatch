/**
 * Route handler tests for `GET /api/org/[orgId]/members` (PROXY).
 *
 * Spec: `sdd/org-members/spec` § R-Members-List (PROXY MODE invariant).
 * Design: `sdd/org-members/design` §6 + Q7.
 *
 * Mirrors `apps/web/src/app/api/org/me/__tests__/route.spec.ts` shape:
 *   - 401 without contacting upstream when session cookie is missing.
 *   - Forwards Authorization + X-Org-Id, pipes status + body + Cache-Control.
 *   - 401 STALE_MEMBERSHIPS body is piped through unchanged (apiFetch
 *     will detect and retry on the client side; the proxy MUST NOT
 *     swallow the structured body).
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
  return new NextRequest('http://localhost:3000/api/org/org-1/members', {
    method: 'GET',
    headers,
  });
}

describe('GET /api/org/[orgId]/members (proxy)', () => {
  it('returns 401 without contacting the API when no session cookie', async () => {
    const res = await GET(reqWithCookie({}), { params: Promise.resolve({ orgId: 'org-1' }) });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards to /org/:orgId/members upstream with Authorization + X-Org-Id', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ members: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
    );

    const res = await GET(reqWithCookie({ cookie: 'JWT_VALUE', orgId: 'org-1' }), {
      params: Promise.resolve({ orgId: 'org-1' }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/org/org-1/members');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer JWT_VALUE');
    expect(headers.get('X-Org-Id')).toBe('org-1');

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toContain('members');
  });

  it('URL-encodes the orgId path segment', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await GET(reqWithCookie({ cookie: 'JWT' }), {
      // `org-with/slash` is contrived but exercises the encoder so a
      // future ID format change can't smuggle a path-traversal segment.
      params: Promise.resolve({ orgId: 'org-with/slash' }),
    });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/org/org-with%2Fslash/members');
  });

  it('pipes 401 STALE_MEMBERSHIPS body through unchanged', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ statusCode: 401, code: 'STALE_MEMBERSHIPS', message: 'stale' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const res = await GET(reqWithCookie({ cookie: 'JWT', orgId: 'org-1' }), {
      params: Promise.resolve({ orgId: 'org-1' }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('STALE_MEMBERSHIPS');
  });

  it('pipes upstream non-2xx status verbatim (e.g. 502)', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"x"}', { status: 502 }));

    const res = await GET(reqWithCookie({ cookie: 'JWT' }), {
      params: Promise.resolve({ orgId: 'org-1' }),
    });
    expect(res.status).toBe(502);
  });
});
