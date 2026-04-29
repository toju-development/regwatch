/**
 * Route handler tests for `DELETE /api/org/[orgId]/invitations/[invitationId]` (PROXY).
 *
 * Spec: `sdd/org-invitations/spec` § R-Invitation-Revoke.
 * Design: `sdd/org-invitations/design` §0 D7 + §4 (proxy-204 foot-gun).
 *
 * Critical assertion: 204 upstream → 204 downstream WITHOUT body. The
 * shared `proxyToApi` helper handles the null-body branch (see
 * `proxy-fetch.ts:146`); these tests anchor that contract for the
 * invitations slice so a future regression in the helper would break
 * here too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { DELETE } from '../route.js';

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

function deleteReq(opts: { cookie?: string; orgId?: string }): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = `authjs.session-token=${opts.cookie}`;
  if (opts.orgId) headers['x-org-id'] = opts.orgId;
  return new NextRequest('http://localhost:3000/api/org/org-1/invitations/inv-1', {
    method: 'DELETE',
    headers,
  });
}

describe('DELETE /api/org/[orgId]/invitations/[invitationId] (proxy)', () => {
  it('returns 401 without contacting upstream when no session cookie', async () => {
    const res = await DELETE(deleteReq({}), {
      params: Promise.resolve({ orgId: 'org-1', invitationId: 'inv-1' }),
    });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards Authorization + X-Org-Id and pipes 204 with NO body (proxy-204 foot-gun)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const res = await DELETE(deleteReq({ cookie: 'JWT', orgId: 'org-1' }), {
      params: Promise.resolve({ orgId: 'org-1', invitationId: 'inv-1' }),
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/org/org-1/invitations/inv-1');
    expect((init as { method: string }).method).toBe('DELETE');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer JWT');
    expect(headers.get('X-Org-Id')).toBe('org-1');

    expect(res.status).toBe(204);
    // Per Fetch spec, 204 MUST have null body. Reading text() returns ''.
    expect(await res.text()).toBe('');
  });

  it('URL-encodes orgId and invitationId path segments', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await DELETE(deleteReq({ cookie: 'JWT' }), {
      params: Promise.resolve({ orgId: 'a/b', invitationId: 'inv 1' }),
    });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/org/a%2Fb/invitations/inv%201');
  });

  it('pipes upstream 410 ALREADY_ACCEPTED through unchanged (with body, since not 204)', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'ALREADY_ACCEPTED' }), {
        status: 410,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await DELETE(deleteReq({ cookie: 'JWT', orgId: 'org-1' }), {
      params: Promise.resolve({ orgId: 'org-1', invitationId: 'inv-1' }),
    });
    expect(res.status).toBe(410);
    expect(((await res.json()) as { code: string }).code).toBe('ALREADY_ACCEPTED');
  });
});
