/**
 * Route handler tests for `PATCH | DELETE /api/org/[orgId]/members/[userId]`
 * (PROXY).
 *
 * Spec: `sdd/org-members/spec`
 *   - § R-Membership-Update (PATCH; PROXY MODE).
 *   - § R-Membership-Remove (DELETE; PROXY MODE; covers self-leave).
 * Design: `sdd/org-members/design` §6 + Q7.
 *
 * Asserts:
 *   - PATCH forwards body + Content-Type and pipes upstream status/body.
 *   - DELETE forwards Authorization + X-Org-Id and pipes 204.
 *   - 401 STALE_MEMBERSHIPS is piped through (apiFetch retries on client).
 *   - 401 (no cookie) returns without contacting upstream.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { PATCH, DELETE } from '../route.js';

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

function patchReq(opts: { cookie?: string; orgId?: string; body?: string }): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.cookie) headers.cookie = `authjs.session-token=${opts.cookie}`;
  if (opts.orgId) headers['x-org-id'] = opts.orgId;
  return new NextRequest('http://localhost:3000/api/org/org-1/members/user-2', {
    method: 'PATCH',
    headers,
    body: opts.body ?? JSON.stringify({ role: 'VIEWER' }),
  });
}

function deleteReq(opts: { cookie?: string; orgId?: string }): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = `authjs.session-token=${opts.cookie}`;
  if (opts.orgId) headers['x-org-id'] = opts.orgId;
  return new NextRequest('http://localhost:3000/api/org/org-1/members/user-2', {
    method: 'DELETE',
    headers,
  });
}

describe('PATCH /api/org/[orgId]/members/[userId] (proxy)', () => {
  it('returns 401 without contacting upstream when no session cookie', async () => {
    const res = await PATCH(patchReq({}), {
      params: Promise.resolve({ orgId: 'org-1', userId: 'user-2' }),
    });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards body + Content-Type + Authorization + X-Org-Id', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const body = JSON.stringify({ role: 'ANALYST' });
    const res = await PATCH(patchReq({ cookie: 'JWT', orgId: 'org-1', body }), {
      params: Promise.resolve({ orgId: 'org-1', userId: 'user-2' }),
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/org/org-1/members/user-2');
    expect((init as { method: string }).method).toBe('PATCH');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer JWT');
    expect(headers.get('X-Org-Id')).toBe('org-1');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(init.body).toBe(body);

    expect(res.status).toBe(200);
  });

  it('pipes 401 STALE_MEMBERSHIPS body through unchanged', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'STALE_MEMBERSHIPS', message: 'stale' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await PATCH(patchReq({ cookie: 'JWT', orgId: 'org-1' }), {
      params: Promise.resolve({ orgId: 'org-1', userId: 'user-2' }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('STALE_MEMBERSHIPS');
  });

  it('pipes upstream 409 LAST_OWNER through unchanged', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'LAST_OWNER' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await PATCH(patchReq({ cookie: 'JWT', orgId: 'org-1' }), {
      params: Promise.resolve({ orgId: 'org-1', userId: 'user-2' }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('LAST_OWNER');
  });
});

describe('DELETE /api/org/[orgId]/members/[userId] (proxy)', () => {
  it('returns 401 without contacting upstream when no session cookie', async () => {
    const res = await DELETE(deleteReq({}), {
      params: Promise.resolve({ orgId: 'org-1', userId: 'user-2' }),
    });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards Authorization + X-Org-Id and pipes 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const res = await DELETE(deleteReq({ cookie: 'JWT', orgId: 'org-1' }), {
      params: Promise.resolve({ orgId: 'org-1', userId: 'user-2' }),
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/org/org-1/members/user-2');
    expect((init as { method: string }).method).toBe('DELETE');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer JWT');
    expect(headers.get('X-Org-Id')).toBe('org-1');

    expect(res.status).toBe(204);
  });

  it('URL-encodes both orgId and userId path segments', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await DELETE(deleteReq({ cookie: 'JWT' }), {
      params: Promise.resolve({ orgId: 'a/b', userId: 'c d' }),
    });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/org/a%2Fb/members/c%20d');
  });

  it('pipes 400 PERSONAL_ORG_UNREMOVABLE through unchanged', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'PERSONAL_ORG_UNREMOVABLE' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await DELETE(deleteReq({ cookie: 'JWT', orgId: 'org-1' }), {
      params: Promise.resolve({ orgId: 'org-1', userId: 'user-2' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('PERSONAL_ORG_UNREMOVABLE');
  });
});
