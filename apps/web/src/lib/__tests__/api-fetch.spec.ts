/**
 * Spec: `sdd/org-membership-ux/spec` § R-ApiFetch
 *   - S1 "Header present on every call"
 *   - S2 "Switcher change reflected immediately"
 *   - S3 "No active org → header omitted"
 *
 * Spec: `sdd/org-members/spec` § R-Jwt-Invalidate-Cross-User
 *   - "Stale JWT → 401 STALE_MEMBERSHIPS" + "Client retries via update({})"
 *   - "Single retry only" (second 401 STALE → throws StaleMembershipsError)
 *   - "Mutation 401-stale also surfaces" (PATCH body buffered for retry)
 *
 * Design: §6 hydration gate (proxy-mode deviation noted in `api-fetch.ts`).
 *
 * Tests use the global `fetch` mock (Vitest 2 supports `vi.spyOn(global, 'fetch')`).
 * The store is reset between cases via `useActiveOrg.getState().reset()`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiFetchHydrationError, apiFetch } from '../api-fetch.js';
import { useActiveOrg } from '../active-org-store.js';
import { StaleMembershipsError } from '../errors.js';
import { registerSessionUpdater } from '../session-update.js';

function mockFetchOk(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function hydrate(activeOrgId: string | null): void {
  const s = useActiveOrg.getState();
  s.setActive(activeOrgId);
  s.markHydrated();
}

beforeEach(() => {
  useActiveOrg.getState().reset();
  registerSessionUpdater(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  registerSessionUpdater(null);
});

describe('apiFetch — proxy-mode path validation', () => {
  it('rejects fully-qualified URLs (proxy mode)', async () => {
    hydrate('org-a');
    await expect(apiFetch('https://api.example.com/org/me')).rejects.toThrow(
      /PROXY MODE.*local path/i,
    );
  });

  it('rejects non-absolute paths', async () => {
    hydrate('org-a');
    await expect(apiFetch('api/org/me')).rejects.toThrow(/must start with "\/api\/"/i);
  });

  it('rejects local paths that do not start with /api/', async () => {
    hydrate('org-a');
    await expect(apiFetch('/foo/bar')).rejects.toThrow(/must start with "\/api\/"/i);
  });
});

describe('apiFetch — hydration gate (design §6)', () => {
  it('throws ApiFetchHydrationError before the provider hydrates', async () => {
    // Default state is `hydrated: false`.
    await expect(apiFetch('/api/org/me')).rejects.toBeInstanceOf(ApiFetchHydrationError);
  });

  it('does NOT call fetch when unhydrated', async () => {
    const fetchMock = mockFetchOk();
    await apiFetch('/api/org/me').catch(() => undefined);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('apiFetch — header attachment (R-ApiFetch S1)', () => {
  it('attaches X-Org-Id from the store when hydrated with an active org', async () => {
    const fetchMock = mockFetchOk();
    hydrate('org-team-a');

    await apiFetch('/api/org/me');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe('/api/org/me');
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('X-Org-Id')).toBe('org-team-a');
    // PROXY MODE: wrapper does NOT touch Authorization (the route
    // handler does that server-side).
    expect(headers.get('Authorization')).toBeNull();
  });

  it('preserves caller-supplied headers and merges X-Org-Id on top', async () => {
    const fetchMock = mockFetchOk();
    hydrate('org-x');

    await apiFetch('/api/org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Trace-Id': 't-1' },
      body: JSON.stringify({ name: 'Acme' }),
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-Trace-Id')).toBe('t-1');
    expect(headers.get('X-Org-Id')).toBe('org-x');
    expect((init as RequestInit).method).toBe('POST');
  });
});

describe('apiFetch — switcher change reflected (R-ApiFetch S2)', () => {
  it('reads the current store value on EACH call (no stale closure)', async () => {
    const fetchMock = mockFetchOk();
    hydrate('org-a');

    await apiFetch('/api/org/me');
    useActiveOrg.getState().setActive('org-b');
    await apiFetch('/api/org/me');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const h1 = new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers);
    const h2 = new Headers((fetchMock.mock.calls[1]![1] as RequestInit).headers);
    expect(h1.get('X-Org-Id')).toBe('org-a');
    expect(h2.get('X-Org-Id')).toBe('org-b');
  });
});

describe('apiFetch — no active org (R-ApiFetch S3)', () => {
  it('omits X-Org-Id when activeOrgId is null', async () => {
    const fetchMock = mockFetchOk();
    hydrate(null);

    await apiFetch('/api/org/me');

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.has('X-Org-Id')).toBe(false);
  });
});

describe('apiFetch — error propagation', () => {
  it('propagates network errors (does not swallow)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('boom');
      }),
    );
    hydrate('org-a');
    await expect(apiFetch('/api/org/me')).rejects.toThrow(/boom/);
  });

  it('returns non-2xx responses as-is (no auto-throw on 4xx/5xx)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403 })),
    );
    hydrate('org-a');
    const r = await apiFetch('/api/org/me');
    expect(r.status).toBe(403);
  });
});

// ──────────────────────────────────────────────────────────────────────
// STALE_MEMBERSHIPS retry — spec `sdd/org-members/spec`
// § R-Jwt-Invalidate-Cross-User. Foot-gun #670 — `update({})` empty obj
// MANDATORY (verified via the updater spy receiving exactly `{}`).
// ──────────────────────────────────────────────────────────────────────

function staleResponse(): Response {
  return new Response(
    JSON.stringify({ statusCode: 401, code: 'STALE_MEMBERSHIPS', message: 'stale' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('apiFetch — STALE_MEMBERSHIPS retry (R-Jwt-Invalidate-Cross-User)', () => {
  it('retries once after session.update({}) and returns the 200 on success', async () => {
    const updater = vi.fn(async () => undefined);
    registerSessionUpdater(updater);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(staleResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    hydrate('org-a');

    const res = await apiFetch('/api/org/org-a/members');

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // #670: the updater MUST be called with `{}` not undefined; this is
    // the SOURCE OF TRUTH for the foot-gun assertion.
    expect(updater).toHaveBeenCalledTimes(1);
    expect(updater).toHaveBeenCalledWith({});
  });

  it('throws StaleMembershipsError on a SECOND 401 STALE (no third retry)', async () => {
    const updater = vi.fn(async () => undefined);
    registerSessionUpdater(updater);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(staleResponse())
      .mockResolvedValueOnce(staleResponse());
    vi.stubGlobal('fetch', fetchMock);
    hydrate('org-a');

    await expect(apiFetch('/api/org/org-a/members')).rejects.toBeInstanceOf(StaleMembershipsError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(updater).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on plain 401 (no STALE_MEMBERSHIPS code) — auth fail surfaces normally', async () => {
    const updater = vi.fn(async () => undefined);
    registerSessionUpdater(updater);

    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ statusCode: 401, message: 'unauth' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    hydrate('org-a');

    const res = await apiFetch('/api/org/org-a/members');
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updater).not.toHaveBeenCalled();
  });

  it('does NOT retry on 401 with non-JSON body', async () => {
    const updater = vi.fn(async () => undefined);
    registerSessionUpdater(updater);

    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    hydrate('org-a');

    const res = await apiFetch('/api/org/org-a/members');
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updater).not.toHaveBeenCalled();
  });

  it('PATCH body is reusable across retry (string body — replays byte-for-byte)', async () => {
    const updater = vi.fn(async () => undefined);
    registerSessionUpdater(updater);

    const body = JSON.stringify({ role: 'VIEWER' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(staleResponse())
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    hydrate('org-a');

    const res = await apiFetch('/api/org/org-a/members/user-2', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    expect(res.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init1] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, init2] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(init1.body).toBe(body);
    expect(init2.body).toBe(body);
    // Both calls must carry X-Org-Id.
    expect(new Headers(init1.headers).get('X-Org-Id')).toBe('org-a');
    expect(new Headers(init2.headers).get('X-Org-Id')).toBe('org-a');
  });

  it('ReadableStream body is buffered before first send so retry can re-post', async () => {
    const updater = vi.fn(async () => undefined);
    registerSessionUpdater(updater);

    const payload = JSON.stringify({ role: 'ANALYST' });
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(payload));
        c.close();
      },
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(staleResponse())
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    hydrate('org-a');

    const res = await apiFetch('/api/org/org-a/members/user-2', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: stream,
    });

    expect(res.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init1] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, init2] = fetchMock.mock.calls[1] as [string, RequestInit];
    // After buffering, both calls carry the same ArrayBuffer (or shared
    // copy) — the key invariant is that retry's body is NOT empty.
    expect(init1.body).toBeInstanceOf(ArrayBuffer);
    expect(init2.body).toBe(init1.body);
    expect(new TextDecoder().decode(init2.body as ArrayBuffer)).toBe(payload);
  });

  it('throws StaleMembershipsError even when no updater is registered (fail-loud)', async () => {
    // Edge case: <ActiveOrgProvider> failed to register (theoretical —
    // the hydration gate would have thrown first), but if somehow
    // hydrated without a registered updater, the second STALE still
    // surfaces correctly. This protects against a silent infinite loop.
    registerSessionUpdater(null);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(staleResponse())
      .mockResolvedValueOnce(staleResponse());
    vi.stubGlobal('fetch', fetchMock);
    hydrate('org-a');

    await expect(apiFetch('/api/org/org-a/members')).rejects.toBeInstanceOf(StaleMembershipsError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
