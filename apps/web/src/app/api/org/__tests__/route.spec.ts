/**
 * Route handler tests for `POST /api/org` (PROXY).
 *
 * Spec: `sdd/org-membership-ux/spec` § R-OrgCreate.
 * Design: §1 (PROXY MODE deviation) + §6.
 *
 * Asserts:
 *   - Forwards request body verbatim to `${API_URL}/org`.
 *   - Sets Authorization from the session cookie.
 *   - Pipes status (e.g. 201 on success).
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

function postReq(body: unknown, opts: { cookie?: string } = {}): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.cookie) headers.cookie = `authjs.session-token=${opts.cookie}`;
  return new NextRequest('http://localhost:3000/api/org', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/org (proxy)', () => {
  it('returns 401 without contacting the API when no session cookie', async () => {
    const res = await POST(postReq({ name: 'New Co' }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards body + Authorization and pipes the upstream 201', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'org-x', name: 'New Co', slug: 'new-co' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await POST(postReq({ name: 'New Co' }, { cookie: 'JWT' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/org');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'New Co' }));
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer JWT');
    expect(headers.get('Content-Type')).toBe('application/json');

    expect(res.status).toBe(201);
    const json = JSON.parse(await res.text()) as { slug: string };
    expect(json.slug).toBe('new-co');
  });
});
