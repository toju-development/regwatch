/**
 * Server Actions for `/alerts/new`.
 *
 * Spec: `sdd/manual-ingestion/spec` § R-10 (Manual ingestion UI)
 *   - S1: successful URL submission → returns alertId for redirect
 *   - S2: client-side jurisdiction validation prevents empty-jurisdiction submit
 *
 * Design: `sdd/manual-ingestion/design`
 *   - Sequence 1 (URL), 2 (PDF), 3 (dedup rejection)
 *   - Uses `apiServerFetch` for URL/text (JSON bodies)
 *   - Builds a multipart forward for PDF (apiServerFetch does not support FormData)
 *
 * Auth: `apiServerFetch` reads the NextAuth session cookie and attaches
 * `Authorization: Bearer <jwt>`. `X-Org-Id` is read from the form field
 * set by the client — the orgId is stored in the Zustand active-org store
 * and embedded in the form before submission.
 *
 * Result envelope mirrors the rest of the actions in this codebase
 * (`{ ok, ... }`). 409 → `{ ok: false, conflict: true, alertId }`.
 *
 * NO `pnpm build` after changes (project rule).
 */
'use server';

import { cookies } from 'next/headers';

import { apiServerFetch, ApiServerUnauthenticatedError } from '@/lib/api-server';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface IngestSuccessResult {
  ok: true;
  alertId: string;
}

export interface IngestConflictResult {
  ok: false;
  conflict: true;
  alertId: string;
}

export interface IngestErrorResult {
  ok: false;
  conflict?: false;
  code: string;
  error: string;
}

export type IngestResult = IngestSuccessResult | IngestConflictResult | IngestErrorResult;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSessionCookieName(): string {
  return process.env.NODE_ENV === 'production'
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';
}

function getApiBaseUrl(): string {
  const url = process.env.API_URL;
  if (!url) throw new Error('API_URL is not configured');
  return url.replace(/\/+$/, '');
}

async function parseResponse(res: Response): Promise<IngestResult> {
  if (res.ok) {
    const data = (await res.json()) as { alertId: string };
    return { ok: true, alertId: data.alertId };
  }
  if (res.status === 409) {
    let existingAlertId = '';
    try {
      const body = (await res.clone().json()) as { alertId?: string; existingAlertId?: string };
      existingAlertId = body.alertId ?? body.existingAlertId ?? '';
    } catch {
      /* non-JSON — leave empty */
    }
    return { ok: false, conflict: true, alertId: existingAlertId };
  }
  let error = `Request failed (${res.status})`;
  try {
    const body = (await res.clone().json()) as { message?: string };
    if (body.message) error = body.message;
  } catch {
    /* non-JSON body */
  }
  const codeMap: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHENTICATED',
    403: 'FORBIDDEN',
    413: 'PAYLOAD_TOO_LARGE',
    422: 'UNPROCESSABLE',
  };
  return { ok: false, code: codeMap[res.status] ?? 'UNKNOWN', error };
}

// ---------------------------------------------------------------------------
// Server Action
// ---------------------------------------------------------------------------

/**
 * Post to `POST /ingest/manual`.
 *
 * @param formData - Native browser FormData from the controlled form.
 *   Expected fields:
 *   - `inputType`    — 'url' | 'pdf' | 'text'
 *   - `jurisdiction` — 'AR' | 'BR' | 'CO' | 'PE' | 'CL'
 *   - `regulatorId`  — optional free-text
 *   - `orgId`        — active org (from client Zustand store, embedded before submit)
 *   URL:  + `url`
 *   PDF:  + `file` (File), `title` (optional)
 *   Text: + `text`, `title`
 */
export async function ingestManual(formData: FormData): Promise<IngestResult> {
  const inputType = (formData.get('inputType') as string | null) ?? '';
  const orgId = (formData.get('orgId') as string | null) ?? undefined;

  try {
    if (inputType === 'pdf') {
      // PDF requires multipart — apiServerFetch only handles JSON.
      // Read the session cookie manually (same logic as apiServerFetch).
      const jar = await cookies();
      const jwt = jar.get(getSessionCookieName())?.value;
      if (!jwt) throw new ApiServerUnauthenticatedError();

      const outForm = new FormData();
      outForm.set('inputType', 'pdf');

      const file = formData.get('file') as File | null;
      if (file) outForm.set('file', file);

      const jurisdiction = (formData.get('jurisdiction') as string | null) ?? '';
      outForm.set('jurisdiction', jurisdiction);

      const title = formData.get('title') as string | null;
      if (title) outForm.set('title', title);

      const regulatorId = formData.get('regulatorId') as string | null;
      if (regulatorId) outForm.set('regulatorId', regulatorId);

      const headers = new Headers();
      headers.set('Authorization', `Bearer ${jwt}`);
      if (orgId) headers.set('X-Org-Id', orgId);

      const res = await fetch(`${getApiBaseUrl()}/ingest/manual`, {
        method: 'POST',
        headers,
        body: outForm,
        cache: 'no-store',
      });
      return await parseResponse(res);
    }

    // URL and text: JSON body via apiServerFetch.
    const body: Record<string, string | undefined> = { type: inputType };
    body.jurisdiction = (formData.get('jurisdiction') as string | null) ?? undefined;
    const regulatorId = formData.get('regulatorId') as string | null;
    if (regulatorId) body.regulator = regulatorId;

    if (inputType === 'url') {
      body.url = (formData.get('url') as string | null) ?? undefined;
      const title = formData.get('title') as string | null;
      if (title) body.title = title;
    } else if (inputType === 'text') {
      body.text = (formData.get('text') as string | null) ?? undefined;
      body.title = (formData.get('title') as string | null) ?? undefined;
    }

    const res = await apiServerFetch('/ingest/manual', {
      method: 'POST',
      ...(orgId !== undefined ? { orgId } : {}),
      body,
    });
    return await parseResponse(res);
  } catch (err) {
    if (err instanceof ApiServerUnauthenticatedError) {
      return { ok: false, code: 'UNAUTHENTICATED', error: err.message };
    }
    throw err;
  }
}
