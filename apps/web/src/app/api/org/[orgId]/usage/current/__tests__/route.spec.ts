/**
 * Route handler tests for `GET /api/org/[orgId]/usage/current` (PROXY).
 *
 * Spec: `sdd/scanner-vertical-ar/spec` § R-12-UsageReadEndpoint,
 *   § R-13-UsageWidget S3.
 * Design: `sdd/scanner-vertical-ar/design` § ADR-12.
 *
 * Mirrors the settings PROXY spec — same `proxyToApi` plumbing, same
 * STALE_MEMBERSHIPS pass-through invariant, same URL-encoding posture.
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

function buildReq(opts: { cookie?: string; orgId?: string } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = `authjs.session-token=${opts.cookie}`;
  if (opts.orgId) headers['x-org-id'] = opts.orgId;
  return new NextRequest('http://localhost:3000/api/org/org-1/usage/current', {
    method: 'GET',
    headers,
  });
}

describe('GET /api/org/[orgId]/usage/current (proxy)', () => {
  it('returns 401 without contacting the API when no session cookie', async () => {
    const res = await GET(buildReq(), { params: Promise.resolve({ orgId: 'org-1' }) });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards to /org/:orgId/usage/current upstream with Authorization + X-Org-Id and pipes Cache-Control', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          currentMonth: {
            tokensUsed: 0,
            costUsd: '0',
            scansCount: 0,
            capUsd: '10',
            percent: 0,
            monthStart: '2026-04-01T00:00:00.000Z',
          },
          isAtCap: false,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        },
      ),
    );

    const res = await GET(buildReq({ cookie: 'JWT_VALUE', orgId: 'org-1' }), {
      params: Promise.resolve({ orgId: 'org-1' }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/org/org-1/usage/current');
    expect(init.method).toBe('GET');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer JWT_VALUE');
    expect(headers.get('X-Org-Id')).toBe('org-1');

    expect(res.status).toBe(200);
    // Cache-Control: no-store mirrors INV-UT-2 (no caching MVP-5).
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as { currentMonth: { capUsd: string } };
    expect(body.currentMonth.capUsd).toBe('10');
  });

  it('URL-encodes the orgId path segment (path-traversal-style id)', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await GET(buildReq({ cookie: 'JWT' }), {
      params: Promise.resolve({ orgId: 'org-with/slash' }),
    });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/org/org-with%2Fslash/usage/current');
  });

  it('pipes 401 STALE_MEMBERSHIPS body through unchanged (apiFetch retries client-side)', async () => {
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

  it('pipes upstream non-2xx status verbatim (e.g. 403 cross-org)', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 403, message: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await GET(buildReq({ cookie: 'JWT', orgId: 'org-1' }), {
      params: Promise.resolve({ orgId: 'org-1' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { statusCode: number };
    expect(body.statusCode).toBe(403);
  });
});
