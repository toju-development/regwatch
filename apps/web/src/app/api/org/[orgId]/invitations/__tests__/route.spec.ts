/**
 * Route handler tests for `GET | POST /api/org/[orgId]/invitations` (PROXY).
 *
 * Spec: `sdd/org-invitations/spec` § R-Invitation-List + R-Invitation-Issue.
 * Design: `sdd/org-invitations/design` §0 D7 (mirrors 3b3a members proxy
 *   pattern in `apps/web/src/app/api/org/[orgId]/members/__tests__/route.spec.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { GET, POST } from '../route.js';

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

function listReq(opts: { cookie?: string; orgId?: string }): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = `authjs.session-token=${opts.cookie}`;
  if (opts.orgId) headers['x-org-id'] = opts.orgId;
  return new NextRequest('http://localhost:3000/api/org/org-1/invitations', {
    method: 'GET',
    headers,
  });
}

function issueReq(opts: { cookie?: string; orgId?: string; body?: string }): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.cookie) headers.cookie = `authjs.session-token=${opts.cookie}`;
  if (opts.orgId) headers['x-org-id'] = opts.orgId;
  return new NextRequest('http://localhost:3000/api/org/org-1/invitations', {
    method: 'POST',
    headers,
    body: opts.body ?? JSON.stringify({ email: 'bob@example.com', role: 'ANALYST' }),
  });
}

describe('GET /api/org/[orgId]/invitations (proxy)', () => {
  it('returns 401 without contacting the API when no session cookie', async () => {
    const res = await GET(listReq({}), { params: Promise.resolve({ orgId: 'org-1' }) });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards to /org/:orgId/invitations with Authorization + X-Org-Id and pipes 200 body + Cache-Control', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ invitations: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
    );

    const res = await GET(listReq({ cookie: 'JWT_VALUE', orgId: 'org-1' }), {
      params: Promise.resolve({ orgId: 'org-1' }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/org/org-1/invitations');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer JWT_VALUE');
    expect(headers.get('X-Org-Id')).toBe('org-1');

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toContain('invitations');
  });

  it('pipes 401 STALE_MEMBERSHIPS body through unchanged (apiFetch retries client-side)', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'STALE_MEMBERSHIPS' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await GET(listReq({ cookie: 'JWT', orgId: 'org-1' }), {
      params: Promise.resolve({ orgId: 'org-1' }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('STALE_MEMBERSHIPS');
  });
});

describe('POST /api/org/[orgId]/invitations (proxy — issue)', () => {
  it('returns 401 without contacting upstream when no session cookie', async () => {
    const res = await POST(issueReq({}), { params: Promise.resolve({ orgId: 'org-1' }) });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards body + Content-Type + Authorization + X-Org-Id and pipes 201', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'inv-1',
          email: 'bob@example.com',
          role: 'ANALYST',
          status: 'PENDING',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const body = JSON.stringify({ email: 'bob@example.com', role: 'ANALYST' });
    const res = await POST(issueReq({ cookie: 'JWT', orgId: 'org-1', body }), {
      params: Promise.resolve({ orgId: 'org-1' }),
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/org/org-1/invitations');
    expect((init as { method: string }).method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer JWT');
    expect(headers.get('X-Org-Id')).toBe('org-1');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(init.body).toBe(body);

    expect(res.status).toBe(201);
    const json = (await res.json()) as { id: string };
    expect(json.id).toBe('inv-1');
  });

  it('pipes upstream 409 ALREADY_MEMBER through unchanged', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'ALREADY_MEMBER' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await POST(issueReq({ cookie: 'JWT', orgId: 'org-1' }), {
      params: Promise.resolve({ orgId: 'org-1' }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('ALREADY_MEMBER');
  });
});
