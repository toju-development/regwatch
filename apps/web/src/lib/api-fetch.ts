/**
 * Client-side `apiFetch` wrapper — PROXY MODE.
 *
 * Spec: `sdd/org-membership-ux/spec` § R-ApiFetch.
 * Design: `sdd/org-membership-ux/design` §6 (with deviation noted below).
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ ARCHITECTURAL DEVIATION FROM design §1-A (LOCKED BY ORCHESTRATOR)│
 * ├─────────────────────────────────────────────────────────────────┤
 * │ Design §1 originally chose Option (B): client calls `apps/api`   │
 * │ DIRECTLY at `${NEXT_PUBLIC_API_URL}/org/...` carrying its own    │
 * │ `Authorization: Bearer <jwt>` header.                            │
 * │                                                                 │
 * │ That design assumed the JWT was readable from client JS. In     │
 * │ practice the NextAuth session cookie is `httpOnly` (it MUST be  │
 * │ to defend against XSS), so the JWT cannot be lifted into client │
 * │ JS without weakening the auth model.                            │
 * │                                                                 │
 * │ Decision (orchestrator + user, B3): switch to PROXY MODE.       │
 * │   - `apiFetch` calls LOCAL paths under `/api/org/*` (handled by │
 * │     route handlers in `apps/web` — added in B4).                │
 * │   - Each route handler reads `auth()` server-side, mints/reads  │
 * │     the JWT, and forwards to `${API_URL}/org/...` with the     │
 * │     `Authorization` header attached server-side.                │
 * │   - The browser sends the NextAuth cookie automatically (same   │
 * │     origin), so this wrapper does NOT touch `Authorization`.    │
 * │                                                                 │
 * │ Tradeoffs (full record in engram                                │
 * │ `regwatch/decisions/org-membership-proxy-mode`):                │
 * │   ✅ JWT stays out of client JS (XSS-resistant).                │
 * │   ✅ No CORS configuration needed for `apps/api`.               │
 * │   ⚠️  Extra hop per request (web → api). Acceptable for MVP.    │
 * │   ⚠️  Each scoped api route needs a corresponding `apps/web`    │
 * │      proxy handler. Tracked in B4 task list.                    │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * What this wrapper DOES:
 *   1. Refuses calls fired before `<ActiveOrgProvider>` hydrates the
 *      Zustand store (throws `ApiFetchHydrationError`). Calling
 *      `apiFetch` pre-hydration is a programming bug — provider gates
 *      scoped-route render until hydration is true (design §6).
 *   2. Reads `activeOrgId` from `useActiveOrg.getState()` (NOT from
 *      cookies — cookies are server-side only).
 *   3. Attaches `X-Org-Id: <activeOrgId>` when present. Per spec
 *      R-ApiFetch S3, OMITS the header when `activeOrgId === null`
 *      (the proxy will respond 403 from `OrgScopeGuard` for non-public
 *      routes — that is the documented contract).
 *   4. Does NOT attach `Authorization` — the proxy handler does that
 *      server-side.
 *
 * What this wrapper does NOT do:
 *   - Hit `apps/api` directly. Use the local proxy paths.
 *   - Read or write cookies (not possible client-side for httpOnly).
 *   - Auto-retry, refresh tokens, or implement SWR semantics. Those
 *     belong in higher-level data hooks.
 */
'use client';

import { useActiveOrg } from './active-org-store.js';

/**
 * Thrown by `apiFetch` when called before `<ActiveOrgProvider>` has
 * hydrated the Zustand store. Surfaces the misuse loudly instead of
 * silently issuing an unauthenticated request.
 */
export class ApiFetchHydrationError extends Error {
  constructor(path: string) {
    super(
      `apiFetch("${path}") called before <ActiveOrgProvider> hydrated the store. ` +
        `Scoped routes MUST render under the provider; gate render on useActiveOrg().hydrated.`,
    );
    this.name = 'ApiFetchHydrationError';
  }
}

/**
 * Path validator: PROXY MODE requires LOCAL paths starting with `/api/`.
 * Catches the most common regression — pasting a fully-qualified
 * `${API_URL}/org/...` URL from the old design.
 */
function assertProxyPath(path: string): void {
  if (/^https?:\/\//i.test(path)) {
    throw new TypeError(
      `apiFetch is in PROXY MODE — pass a local path (e.g. "/api/org/me"), not a fully-qualified URL. Got: ${JSON.stringify(path)}`,
    );
  }
  if (!path.startsWith('/')) {
    throw new TypeError(
      `apiFetch path must be a local absolute path (e.g. "/api/org/me"). Got: ${JSON.stringify(path)}`,
    );
  }
}

/**
 * `apiFetch(path, init?)` — see file header for the contract.
 *
 * @param path - Local Next.js route-handler path (must start with `/`).
 *               Conventionally lives under `/api/org/*` for the org
 *               capability; future capabilities follow the same shape.
 * @param init - Standard `RequestInit`. Headers passed in by the caller
 *               are preserved; `X-Org-Id` is appended when an active
 *               org is hydrated.
 * @throws {ApiFetchHydrationError} when the store is not yet hydrated.
 * @throws {TypeError} when `path` is not a local absolute path.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  assertProxyPath(path);

  const { hydrated, activeOrgId } = useActiveOrg.getState();
  if (!hydrated) {
    throw new ApiFetchHydrationError(path);
  }

  const headers = new Headers(init.headers);
  // Per spec R-ApiFetch S3: omit `X-Org-Id` when no active org. The
  // server enforces; the wrapper does not pretend.
  if (activeOrgId !== null) {
    headers.set('X-Org-Id', activeOrgId);
  }

  return fetch(path, { ...init, headers });
}
