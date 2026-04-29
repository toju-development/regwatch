/**
 * Server actions for `/settings/preferences`.
 *
 * Spec: `sdd/jurisdictions-config/spec` § R-Settings-Preferences-Page
 *   (validation surfaces inline; revalidatePath only on success;
 *    ANALYST/VIEWER PUT → 403 surfaces as `FORBIDDEN`).
 * Design: `sdd/jurisdictions-config/design` §0 D11, §3 (PUT data flow).
 *
 * Architecture:
 *   - Mirrors `components/members/actions.ts` posture: server action
 *     calls `apiServerFetch` (server-side `apps/api` direct fetch — NOT
 *     the proxy), then `revalidatePath` on success.
 *   - Validation runs CLIENT-OF-API side via `UpdateSettingsSchema` from
 *     `@regwatch/types` BEFORE the upstream PUT — saves a network hop
 *     for obvious rejections AND lets the form render targeted
 *     fieldErrors. The API ALSO validates (defense in depth via
 *     `ZodBodyPipe`); if upstream returns 400 we surface the body
 *     verbatim.
 *   - STALE_MEMBERSHIPS surface contract identical to members actions:
 *     server cannot drive `useSession().update({})`, so we return a
 *     code; the client component refreshes + retries.
 */
'use server';

import { revalidatePath } from 'next/cache';

import { UpdateSettingsSchema, type UpdateSettingsInput } from '@regwatch/types';

import {
  apiServerFetch,
  isStaleMembershipsResponse,
  ApiServerUnauthenticatedError,
} from '@/lib/api-server';

/**
 * Result envelope for `updateSettingsAction`.
 *
 * On VALIDATION (client-side or upstream 400), `fieldErrors` carries a
 * Zod-shaped `{ [path]: [message,...] }` map so the form can render
 * inline messages next to the offending field.
 */
export interface UpdateSettingsResult {
  ok: boolean;
  error?: string;
  /**
   * Zod field-error map (per-field message arrays). Present on
   * `code === 'VALIDATION'` from either the client-side parse OR a
   * 400 upstream that included a `fieldErrors` body.
   */
  fieldErrors?: Record<string, string[]>;
  /**
   * Stable, machine-readable error code. One of:
   *   - `STALE_MEMBERSHIPS`  — JWT mv claim is older than live; client
   *                            must `useSession().update({})` and retry.
   *   - `VALIDATION`         — client-side OR upstream Zod failure.
   *   - `FORBIDDEN`          — RolesGuard rejection (ANALYST/VIEWER PUT).
   *   - `UNAUTHENTICATED`    — no session cookie (programming bug).
   *   - `NOT_FOUND`          — generic 404.
   *   - `UNKNOWN`            — fallback for unexpected statuses.
   */
  code?:
    | 'STALE_MEMBERSHIPS'
    | 'VALIDATION'
    | 'FORBIDDEN'
    | 'UNAUTHENTICATED'
    | 'NOT_FOUND'
    | 'UNKNOWN';
}

/**
 * Translate an upstream non-2xx response into an
 * {@link UpdateSettingsResult}.
 */
async function translateError(res: Response): Promise<UpdateSettingsResult> {
  if (await isStaleMembershipsResponse(res)) {
    return { ok: false, code: 'STALE_MEMBERSHIPS', error: 'Session is stale' };
  }
  let body: { fieldErrors?: Record<string, string[]>; message?: string } = {};
  try {
    body = (await res.clone().json()) as typeof body;
  } catch {
    /* non-JSON body */
  }
  const message = body.message ?? `Request failed (${res.status})`;
  switch (res.status) {
    case 400:
    case 422:
      return {
        ok: false,
        code: 'VALIDATION',
        error: message,
        fieldErrors: body.fieldErrors ?? {},
      };
    case 401:
      return { ok: false, code: 'UNAUTHENTICATED', error: message };
    case 403:
      return { ok: false, code: 'FORBIDDEN', error: message };
    case 404:
      return { ok: false, code: 'NOT_FOUND', error: message };
    default:
      return { ok: false, code: 'UNKNOWN', error: message };
  }
}

/**
 * Convert a Zod v4 `flatten().fieldErrors` map (which uses string keys
 * from the leaf paths) into the shape the form consumes.
 */
function zodFieldErrors(
  errors: Record<string, string[] | undefined> | undefined,
): Record<string, string[]> {
  if (!errors) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(errors)) {
    if (Array.isArray(v) && v.length > 0) out[k] = v;
  }
  return out;
}

/**
 * `PUT /org/:orgId/settings` — full-replace update of the org's settings
 * row. On success: `revalidatePath('/settings/preferences')` so the RSC
 * re-fetches and the form re-mounts with the new initial values. On
 * VALIDATION / FORBIDDEN / STALE / UNKNOWN: `revalidatePath` is NOT
 * called (per spec scenario "revalidatePath only on success").
 *
 * @param orgId - Org under which to update settings (also used as
 *                `X-Org-Id` for `OrgScopeGuard`).
 * @param input - Untrusted form payload. Validated client-of-API side
 *                via {@link UpdateSettingsSchema} BEFORE the upstream
 *                hop.
 */
export async function updateSettingsAction(
  orgId: string,
  input: unknown,
): Promise<UpdateSettingsResult> {
  // 1. Client-of-API validation gate. Catches the obvious failures
  //    (empty jurisdictions, hour out of range, weekly+CSV day) without
  //    a network round-trip. The API ALSO validates — defense in depth.
  const parsed = UpdateSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION',
      error: 'Invalid settings payload.',
      fieldErrors: zodFieldErrors(parsed.error.flatten().fieldErrors),
    };
  }
  const body: UpdateSettingsInput = parsed.data;

  try {
    const res = await apiServerFetch(`/org/${encodeURIComponent(orgId)}/settings`, {
      method: 'PUT',
      orgId,
      body,
    });
    if (!res.ok) return await translateError(res);
    revalidatePath('/settings/preferences');
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiServerUnauthenticatedError) {
      return { ok: false, code: 'UNAUTHENTICATED', error: err.message };
    }
    throw err;
  }
}
