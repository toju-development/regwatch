/**
 * Route handler tests for `GET /api/invitations/[token]` (PUBLIC PROXY).
 *
 * Spec: `sdd/org-invitations/spec` § R-Invitation-Preview.
 * Design: `sdd/org-invitations/design` §0 D6 (middleware allowlist) + D7.
 *
 * Anchors:
 *   - Anonymous call (NO session cookie) STILL hits upstream — the public
 *     preview proxy MUST NOT short-circuit 401 the way authed proxies do.
 *   - NO `Authorization` and NO `X-Org-Id` are forwarded.
 *   - Cache-Control is mirrored (or defaulted to `no-store`).
 *   - Status pipes through verbatim (200 PENDING / 410 various / 404).
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

function previewReq(opts: { cookie?: string } = {}): NextRequest {
  const headers: Record<string, string> = {};
  // We deliberately accept a cookie here in some tests to PROVE it isn't
  // forwarded — the public preview MUST be anonymous upstream regardless
  // of caller-side session state.
  if (opts.cookie) headers.cookie = `authjs.session-token=${opts.cookie}`;
  return new NextRequest('http://localhost:3000/api/invitations/some-token', {
    method: 'GET',
    headers,
  });
}

describe('GET /api/invitations/[token] (public proxy — anonymous capable)', () => {
  it('forwards anonymously to /invitations/<token> WITHOUT Authorization or X-Org-Id', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          orgName: 'Acme',
          orgSlug: 'acme',
          inviterName: 'Alice',
          role: 'ANALYST',
          expiresAt: '2030-01-01T00:00:00.000Z',
          status: 'PENDING',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        },
      ),
    );

    const res = await GET(previewReq(), { params: Promise.resolve({ token: 'some-token' }) });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/invitations/some-token');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('X-Org-Id')).toBeNull();
    expect((init as { cache?: string }).cache).toBe('no-store');

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as { orgName: string };
    expect(body.orgName).toBe('Acme');
  });

  it('does NOT forward the session cookie even when present (preview is @Public upstream)', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await GET(previewReq({ cookie: 'JWT_FROM_BROWSER' }), {
      params: Promise.resolve({ token: 'some-token' }),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBeNull();
    expect(headers.get('Cookie')).toBeNull();
  });

  it('URL-encodes the token path segment', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await GET(previewReq(), { params: Promise.resolve({ token: 'a/b c' }) });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/invitations/a%2Fb%20c');
  });

  it('pipes 410 INVITATION_EXPIRED through unchanged', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'INVITATION_EXPIRED' }), {
        status: 410,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await GET(previewReq(), { params: Promise.resolve({ token: 'tk' }) });
    expect(res.status).toBe(410);
    expect(((await res.json()) as { code: string }).code).toBe('INVITATION_EXPIRED');
  });

  it('pipes 404 INVITATION_NOT_FOUND through unchanged', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'INVITATION_NOT_FOUND' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await GET(previewReq(), { params: Promise.resolve({ token: 'tk' }) });
    expect(res.status).toBe(404);
  });
});
