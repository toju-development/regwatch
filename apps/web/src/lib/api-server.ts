/**
 * Server-side `apps/api` caller for RSC + Server Actions.
 *
 * Spec: `sdd/org-members/spec` — R-Members-List, R-Membership-Update,
 *   R-Membership-Remove (the actions calling this helper).
 * Design: `sdd/org-members/design` §6 (frontend integration). Direct
 *   upstream calls — NOT a self-HTTP hop — per the post-Copilot SSRF
 *   hardening note in `apps/web/src/components/org-switcher/actions.ts`.
 *
 * Why this exists separately from `proxy-fetch.ts` and `api-fetch.ts`:
 *   - `proxy-fetch.ts` is for `apps/web/src/app/api/*` route handlers —
 *     they receive a `NextRequest` and pipe a `NextResponse`. RSC and
 *     server actions don't have those.
 *   - `api-fetch.ts` is `'use client'` (PROXY MODE) — it goes
 *     browser → /api/* → upstream and reads `activeOrgId` from the
 *     hydrated Zustand store. Neither applies on the server.
 *   - This helper consolidates the "server-side action / RSC → upstream
 *     `apps/api`" path: read the NextAuth session cookie, attach as
 *     `Authorization: Bearer`, optionally attach `X-Org-Id`, set
 *     `cache: 'no-store'`. Exactly what `createOrgAction` already does
 *     inline; we factor it once so members + future capabilities reuse.
 *
 * SSRF posture: builds the upstream URL exclusively from
 * `process.env.API_URL` (validated by `createWebEnv` in production). NO
 * `Host`-header derivation, NO self-URL construction.
 *
 * Stale-membership behaviour: this helper does NOT auto-retry the way
 * the client `apiFetch` does — server actions cannot drive the
 * NextAuth session updater (that is a `useSession()` hook concern). The
 * caller (a server action) inspects the response for
 * `401 + body.code === 'STALE_MEMBERSHIPS'` and surfaces it to the
 * client; the client component triggers `useSession().update({})` then
 * retries OR signs out (per spec R-Jwt-Invalidate-Cross-User).
 */
import 'server-only';

import { cookies } from 'next/headers';

function getSessionCookieName(): string {
  return process.env.NODE_ENV === 'production'
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';
}

function getApiBaseUrl(): string {
  const url = process.env.API_URL;
  if (!url) {
    throw new Error(
      'apiServerFetch: process.env.API_URL is not set. Configure it via apps/web/.env.example.',
    );
  }
  return url.replace(/\/+$/, '');
}

export interface ApiServerFetchInit {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /**
   * JSON-serialisable body. Helper handles `JSON.stringify` and
   * `Content-Type` so callers stay terse. Pass `undefined` for verbs
   * without a body.
   */
  body?: unknown;
  /**
   * `X-Org-Id` value when the upstream route is org-scoped. Required for
   * everything under `/org/:orgId/*` so the API's `OrgScopeGuard` can
   * verify membership.
   */
  orgId?: string;
}

/**
 * Sentinel thrown when the session cookie is missing — callers MUST
 * handle and translate to a 401 / sign-out flow. Distinct error class
 * so server actions can `instanceof`-discriminate without parsing
 * messages.
 */
export class ApiServerUnauthenticatedError extends Error {
  constructor() {
    super('apiServerFetch: no NextAuth session cookie present.');
    this.name = 'ApiServerUnauthenticatedError';
  }
}

/**
 * Issue a server-side request to `apps/api`. Returns the raw `Response`
 * so callers can branch on `status` + body shape (this is the consumer
 * of the structured `{ code: 'STALE_MEMBERSHIPS' }` 401 contract).
 *
 * Throws {@link ApiServerUnauthenticatedError} if no session cookie is
 * available — that means the action ran outside a logged-in request and
 * is a programming bug at the call site.
 */
export async function apiServerFetch(path: string, init: ApiServerFetchInit): Promise<Response> {
  const jar = await cookies();
  const jwt = jar.get(getSessionCookieName())?.value;
  if (!jwt) {
    throw new ApiServerUnauthenticatedError();
  }
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${jwt}`);
  if (init.orgId !== undefined) headers.set('X-Org-Id', init.orgId);
  let body: BodyInit | undefined;
  if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${getApiBaseUrl()}${path}`, {
    method: init.method,
    headers,
    ...(body !== undefined ? { body } : {}),
    cache: 'no-store',
  });
}

/**
 * Helper: detect the `{ code: 'STALE_MEMBERSHIPS' }` shape on a 401
 * response. Mirrors the client-side detector in `api-fetch.ts` so the
 * two stay in lockstep.
 */
export async function isStaleMembershipsResponse(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  try {
    const body = (await res.clone().json()) as { code?: unknown };
    return body?.code === 'STALE_MEMBERSHIPS';
  } catch {
    return false;
  }
}
