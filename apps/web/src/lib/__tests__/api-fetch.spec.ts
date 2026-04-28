/**
 * Spec: `sdd/org-membership-ux/spec` § R-ApiFetch
 *   - S1 "Header present on every call"
 *   - S2 "Switcher change reflected immediately"
 *   - S3 "No active org → header omitted"
 *
 * Design: §6 hydration gate (proxy-mode deviation noted in `api-fetch.ts`).
 *
 * Tests use the global `fetch` mock (Vitest 2 supports `vi.spyOn(global, 'fetch')`).
 * The store is reset between cases via `useActiveOrg.getState().reset()`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiFetchHydrationError, apiFetch } from '../api-fetch.js';
import { useActiveOrg } from '../active-org-store.js';

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
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    await expect(apiFetch('api/org/me')).rejects.toThrow(/local absolute path/i);
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
