/**
 * @vitest-environment node
 *
 * Contract tests for `settings/actions.ts` (`updateSettingsAction`).
 *
 * Spec: `sdd/jurisdictions-config/spec` § R-Settings-Preferences-Page
 *   - "revalidatePath only on success"
 *   - "Validation error surfaces inline" (client-side gate via
 *     `UpdateSettingsSchema` BEFORE the upstream hop)
 *   - "ANALYST cannot submit" (upstream RolesGuard 403 surface)
 *   - STALE_MEMBERSHIPS surface contract (mirrors members actions).
 *
 * Mocks (mirror `members/__tests__/actions.spec.ts`):
 *   - `next/headers` cookies (so `apiServerFetch` finds a session token).
 *   - `next/cache` `revalidatePath` (assert it ran ONLY on success).
 *   - global `fetch` for the upstream `apps/api` PUT.
 *
 * Why `node` env: `apiServerFetch` imports `next/headers` and
 * `'server-only'` (stubbed by vitest config), neither of which behave
 * under jsdom.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_SETTINGS } from '@regwatch/types';

const cookieGet = vi.fn();
const revalidatePath = vi.fn();

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: cookieGet }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

import { updateSettingsAction } from '../actions.js';

const fetchMock = vi.fn();

beforeEach(() => {
  cookieGet.mockReset();
  cookieGet.mockReturnValue({ value: 'jwt-token-value' });
  revalidatePath.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('API_URL', 'http://api.test');
  vi.stubEnv('NODE_ENV', 'development');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('updateSettingsAction', () => {
  it('PUTs full body and revalidates `/settings/preferences` on 200', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { settings: { ...DEFAULT_SETTINGS, organizationId: 'org-1' } }),
    );

    const result = await updateSettingsAction('org-1', DEFAULT_SETTINGS);

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://api.test/org/org-1/settings');
    expect((init as RequestInit).method).toBe('PUT');
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer jwt-token-value');
    expect(headers.get('X-Org-Id')).toBe('org-1');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect((init as RequestInit).body).toBe(JSON.stringify(DEFAULT_SETTINGS));
    expect(revalidatePath).toHaveBeenCalledWith('/settings/preferences');
  });

  it('rejects invalid input client-side BEFORE the upstream hop', async () => {
    // No enabled jurisdiction → NO_ENABLED_JURISDICTION refine fails.
    const invalid = {
      ...DEFAULT_SETTINGS,
      jurisdictions: DEFAULT_SETTINGS.jurisdictions.map((j) => ({ ...j, enabled: false })),
    };

    const result = await updateSettingsAction('org-1', invalid);

    expect(result.ok).toBe(false);
    expect(result.code).toBe('VALIDATION');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('translates upstream 403 to FORBIDDEN and does NOT revalidate', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { message: 'forbidden' }));

    const result = await updateSettingsAction('org-1', DEFAULT_SETTINGS);

    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('surfaces STALE_MEMBERSHIPS as code (not raw 401), no revalidate', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { code: 'STALE_MEMBERSHIPS' }));

    const result = await updateSettingsAction('org-1', DEFAULT_SETTINGS);

    expect(result).toMatchObject({ ok: false, code: 'STALE_MEMBERSHIPS' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('passes through upstream 400 fieldErrors verbatim as VALIDATION', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        message: 'Invalid body',
        fieldErrors: { scanHour: ['INVALID_HOUR'] },
      }),
    );

    const result = await updateSettingsAction('org-1', DEFAULT_SETTINGS);

    expect(result).toMatchObject({
      ok: false,
      code: 'VALIDATION',
      fieldErrors: { scanHour: ['INVALID_HOUR'] },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('maps upstream Zod issues[] (jurisdictions path) into fieldErrors', async () => {
    // `apps/api`'s `ZodBodyPipe` emits `{ message, issues }`, NOT
    // `fieldErrors`. translateError must locally map issues so the form
    // can render inline messages.
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        message: 'Validation failed',
        issues: [{ path: ['jurisdictions'], message: 'EMPTY_JURISDICTIONS' }],
      }),
    );

    const result = await updateSettingsAction('org-1', DEFAULT_SETTINGS);

    expect(result).toMatchObject({
      ok: false,
      code: 'VALIDATION',
      fieldErrors: { jurisdictions: ['EMPTY_JURISDICTIONS'] },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('maps upstream Zod issues[] (scanDay path) into fieldErrors', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        message: 'Validation failed',
        issues: [{ path: ['scanDay'], message: 'CUSTOM_REQUIRES_DAY_LIST' }],
      }),
    );

    const result = await updateSettingsAction('org-1', DEFAULT_SETTINGS);

    expect(result).toMatchObject({
      ok: false,
      code: 'VALIDATION',
      fieldErrors: { scanDay: ['CUSTOM_REQUIRES_DAY_LIST'] },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns empty fieldErrors when upstream 400 body has no issues nor fieldErrors', async () => {
    // Defensive: a malformed/non-Zod 400 body must not crash; surface
    // VALIDATION with an empty map so the form can still show the
    // top-level message.
    fetchMock.mockResolvedValue(jsonResponse(400, { message: 'Bad request' }));

    const result = await updateSettingsAction('org-1', DEFAULT_SETTINGS);

    expect(result).toMatchObject({
      ok: false,
      code: 'VALIDATION',
      error: 'Bad request',
      fieldErrors: {},
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns UNAUTHENTICATED when no session cookie is present', async () => {
    cookieGet.mockReturnValue(undefined);

    const result = await updateSettingsAction('org-1', DEFAULT_SETTINGS);

    expect(result).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to UNKNOWN for unexpected upstream statuses', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { message: 'down' }));

    const result = await updateSettingsAction('org-1', DEFAULT_SETTINGS);

    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
