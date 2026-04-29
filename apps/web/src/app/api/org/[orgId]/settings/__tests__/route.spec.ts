/**
 * Route handler tests for `GET | PUT /api/org/[orgId]/settings` (PROXY).
 *
 * Spec: `sdd/jurisdictions-config/spec` § R-Settings-Web-Proxy.
 * Design: `sdd/jurisdictions-config/design` §0 D10.
 *
 * Mirrors `apps/web/src/app/api/org/[orgId]/members/__tests__/route.spec.ts`:
 *   - 401 without contacting upstream when session cookie is missing.
 *   - Forwards Authorization + X-Org-Id, pipes status + body + Cache-Control.
 *   - PUT forwards body byte-for-byte.
 *   - 401 STALE_MEMBERSHIPS body is piped through unchanged (apiFetch
 *     will detect and retry on the client side; the proxy MUST NOT
 *     swallow the structured body).
 *   - 400 validation body is piped through unchanged.
 *   - URL-encodes the orgId path segment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { GET, PUT } from '../route.js';

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

function buildReq(opts: {
  method?: 'GET' | 'PUT';
  cookie?: string;
  orgId?: string;
  body?: string;
  contentType?: string;
}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = `authjs.session-token=${opts.cookie}`;
  if (opts.orgId) headers['x-org-id'] = opts.orgId;
  if (opts.contentType) headers['content-type'] = opts.contentType;
  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method: opts.method ?? 'GET',
    headers,
  };
  if (opts.body !== undefined) init.body = opts.body;
  return new NextRequest('http://localhost:3000/api/org/org-1/settings', init);
}

describe('GET /api/org/[orgId]/settings (proxy)', () => {
  it('returns 401 without contacting the API when no session cookie', async () => {
    const res = await GET(buildReq({}), { params: Promise.resolve({ orgId: 'org-1' }) });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards to /org/:orgId/settings upstream with Authorization + X-Org-Id', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ settings: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
    );

    const res = await GET(buildReq({ cookie: 'JWT_VALUE', orgId: 'org-1' }), {
      params: Promise.resolve({ orgId: 'org-1' }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/org/org-1/settings');
    expect(init.method).toBe('GET');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer JWT_VALUE');
    expect(headers.get('X-Org-Id')).toBe('org-1');

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toContain('settings');
  });

  it('URL-encodes the orgId path segment', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await GET(buildReq({ cookie: 'JWT' }), {
      // contrived path-traversal-style id — exercises the encoder so a
      // future ID format change can't smuggle a path segment.
      params: Promise.resolve({ orgId: 'org-with/slash' }),
    });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/org/org-with%2Fslash/settings');
  });

  it('pipes 401 STALE_MEMBERSHIPS body through unchanged', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ statusCode: 401, code: 'STALE_MEMBERSHIPS', message: 'stale' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const res = await GET(buildReq({ cookie: 'JWT', orgId: 'org-1' }), {
      params: Promise.resolve({ orgId: 'org-1' }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('STALE_MEMBERSHIPS');
  });

  it('pipes upstream non-2xx status verbatim (e.g. 502)', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"x"}', { status: 502 }));

    const res = await GET(buildReq({ cookie: 'JWT' }), {
      params: Promise.resolve({ orgId: 'org-1' }),
    });
    expect(res.status).toBe(502);
  });
});

describe('PUT /api/org/[orgId]/settings (proxy)', () => {
  it('returns 401 without contacting the API when no session cookie', async () => {
    const res = await PUT(buildReq({ method: 'PUT', body: '{}' }), {
      params: Promise.resolve({ orgId: 'org-1' }),
    });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards body byte-for-byte with Authorization + X-Org-Id + Content-Type', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ settings: { scanHour: 14 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
    );

    const payload = JSON.stringify({
      jurisdictions: [{ code: 'AR', enabled: true, customTopics: '' }],
      scanSchedule: 'daily',
      scanDay: 'mon',
      scanHour: 14,
    });

    const res = await PUT(
      buildReq({
        method: 'PUT',
        cookie: 'JWT_VALUE',
        orgId: 'org-1',
        body: payload,
        contentType: 'application/json',
      }),
      { params: Promise.resolve({ orgId: 'org-1' }) },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/org/org-1/settings');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(payload);
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer JWT_VALUE');
    expect(headers.get('X-Org-Id')).toBe('org-1');
    expect(headers.get('Content-Type')).toBe('application/json');

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toContain('scanHour');
  });

  it('pipes 400 validation body through unchanged', async () => {
    const errBody = JSON.stringify({
      statusCode: 400,
      message: 'Validation failed',
      fieldErrors: { scanHour: ['INVALID_HOUR'] },
    });
    fetchMock.mockResolvedValue(
      new Response(errBody, {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await PUT(
      buildReq({
        method: 'PUT',
        cookie: 'JWT',
        orgId: 'org-1',
        body: '{"scanHour":99}',
        contentType: 'application/json',
      }),
      { params: Promise.resolve({ orgId: 'org-1' }) },
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { fieldErrors: Record<string, string[]> };
    expect(body.fieldErrors.scanHour).toEqual(['INVALID_HOUR']);
  });

  it('pipes 403 RolesGuard body through unchanged (no event side-effect on client)', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 403, message: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await PUT(buildReq({ method: 'PUT', cookie: 'JWT', orgId: 'org-1', body: '{}' }), {
      params: Promise.resolve({ orgId: 'org-1' }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { statusCode: number };
    expect(body.statusCode).toBe(403);
  });

  it('pipes 401 STALE_MEMBERSHIPS body through unchanged for PUT (apiFetch retries client-side)', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ statusCode: 401, code: 'STALE_MEMBERSHIPS', message: 'stale' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const res = await PUT(buildReq({ method: 'PUT', cookie: 'JWT', orgId: 'org-1', body: '{}' }), {
      params: Promise.resolve({ orgId: 'org-1' }),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('STALE_MEMBERSHIPS');
  });
});
