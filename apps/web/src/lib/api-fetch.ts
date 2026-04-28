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
 *   5. Performs ONE silent retry on 401 `{ code: 'STALE_MEMBERSHIPS' }`
 *      after invoking NextAuth `session.update({})` (foot-gun #670 —
 *      empty-object literal MANDATORY). Spec
 *      `sdd/org-members/spec` § R-Jwt-Invalidate-Cross-User requires
 *      this so cross-user role changes propagate without a hard reload.
 *      Bodies are buffered before the first send so PATCH/DELETE retries
 *      re-post the same payload byte-for-byte. A second 401 STALE
 *      throws `StaleMembershipsError` — the caller (B6) handles
 *      sign-out + redirect.
 *
 * What this wrapper does NOT do:
 *   - Hit `apps/api` directly. Use the local proxy paths.
 *   - Read or write cookies (not possible client-side for httpOnly).
 *   - Call `signOut()` itself — `StaleMembershipsError` is the signal,
 *     B6 wires up the actual sign-out at the page/component edge.
 *   - Auto-retry beyond the single STALE case. There is no SWR /
 *     network-error retry; those belong in higher-level data hooks.
 */
'use client';

import { useActiveOrg } from './active-org-store.js';
import { StaleMembershipsError } from './errors.js';
import { triggerSessionUpdate } from './session-update.js';

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
  if (!path.startsWith('/api/')) {
    throw new TypeError(
      `apiFetch path must start with "/api/" (PROXY MODE — e.g. "/api/org/me"). Got: ${JSON.stringify(path)}`,
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
 * @throws {StaleMembershipsError} when the API returns 401
 *               `STALE_MEMBERSHIPS` twice in a row (first call → retry
 *               after `session.update({})` → still 401 STALE). The B6
 *               layer catches this to drive sign-out + redirect; this
 *               wrapper NEVER calls `signOut()` itself (separation of
 *               concerns: `apiFetch` is a transport, not a UX driver).
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  assertProxyPath(path);

  const { hydrated, activeOrgId } = useActiveOrg.getState();
  if (!hydrated) {
    throw new ApiFetchHydrationError(path);
  }

  // ── Build the fetch init shared by the first request and (potentially)
  //    a single retry. We:
  //    1. Materialize a `ReadableStream` body to an `ArrayBuffer` BEFORE
  //       the first send. Streams are one-shot; without buffering, a
  //       PATCH/DELETE retry would post an empty body and the API would
  //       see a different request than the original. JSON-stringified
  //       string bodies (the common case) are already repeatable, but we
  //       buffer streams uniformly so the retry path doesn't depend on
  //       caller body type.
  //    2. Merge `X-Org-Id` from the store on top of caller headers (per
  //       R-ApiFetch S1; omitted when null per S3).
  const bufferedInit = await bufferRequestBody(init);
  const headers = new Headers(bufferedInit.headers);
  if (activeOrgId !== null) {
    headers.set('X-Org-Id', activeOrgId);
  }
  const finalInit: RequestInit = { ...bufferedInit, headers };

  // ── First attempt.
  const first = await fetch(path, finalInit);
  if (first.status !== 401) return first;
  if (!(await isStaleMembershipsResponse(first))) return first;

  // ── 401 STALE_MEMBERSHIPS: the API rejected because the JWT `mv` claim
  //    is older than `User.membershipsVersion` (cross-user invalidation —
  //    spec R-Jwt-Invalidate-Cross-User). Re-mint via NextAuth's
  //    `update({})` (#670 — empty object literal mandatory) then retry
  //    the original request EXACTLY ONCE. Idempotency for non-GET verbs
  //    is safe because the freshness guard rejects BEFORE the controller
  //    runs (spec scenario "Mutation 401-stale also surfaces"), so the
  //    server never observed the original write.
  await triggerSessionUpdate();
  const retry = await fetch(path, finalInit);
  if (retry.status !== 401) return retry;
  if (!(await isStaleMembershipsResponse(retry))) return retry;

  // ── Second 401 STALE — surface to caller. NEVER auto-retry past one.
  //    A third attempt would risk infinite ping-pong if the API and
  //    NextAuth disagree about claim freshness for any reason.
  throw new StaleMembershipsError();
}

/**
 * Returns a (shallow) copy of `init` whose `body` is repeatable. Most
 * callers pass strings (from `JSON.stringify(...)`) or `URLSearchParams`,
 * which are already replayable; we only convert `ReadableStream` bodies.
 *
 * IMPORTANT: do NOT swap `Blob` / `FormData` / `URLSearchParams` /
 * `ArrayBuffer` / strings — those are repeatable and converting them
 * would change the upstream request's `Content-Type` defaulting (e.g.
 * `FormData` triggers a multipart boundary the platform sets on send).
 */
async function bufferRequestBody(init: RequestInit): Promise<RequestInit> {
  const body = init.body;
  if (body == null) return init;
  // `instanceof ReadableStream` is enough: the spec's other body types
  // (`string`, `URLSearchParams`, `FormData`, `Blob`, `ArrayBuffer` and
  // typed arrays) are already byte-stable and reusable across calls.
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    const buf = await new Response(body).arrayBuffer();
    return { ...init, body: buf };
  }
  return init;
}

/**
 * Detects the `{ code: 'STALE_MEMBERSHIPS' }` 401 body shape produced by
 * the API's `MembershipFreshnessGuard`. Reads from a CLONED response so
 * the original body remains consumable by the caller (e.g. when the
 * second 401 is NOT stale and we return it as-is).
 */
async function isStaleMembershipsResponse(res: Response): Promise<boolean> {
  try {
    const body = (await res.clone().json()) as { code?: unknown };
    return body?.code === 'STALE_MEMBERSHIPS';
  } catch {
    // Non-JSON 401 → not the guard's structured body → no retry.
    return false;
  }
}
