/**
 * Active-org cookie I/O for `apps/web`.
 *
 * Spec: `sdd/org-membership-ux/spec` § R-ActiveOrgCookie.
 * Design: `sdd/org-membership-ux/design` §3 + decision #1.
 *
 * The active org is persisted as an HttpOnly cookie so it can be read
 * server-side (RSC, route handlers, future edge middleware) but NEVER
 * by client JS. Client code reads `activeOrgId` from the Zustand store
 * (seeded from RSC props) — see `active-org-store.ts` + `apiFetch`.
 *
 * Cookie name varies by environment to honour the `__Secure-` prefix
 * convention already used by NextAuth in production:
 *   - dev/test → `regwatch.active-org`
 *   - prod     → `__Secure-regwatch.active-org`
 *
 * NOTE on `NODE_ENV` access: per `regwatch/footguns/node-env-readonly`
 * (MVP-3b1 B7 discovery), `process.env.NODE_ENV` is NOT writable in
 * Node — tests MUST use `vi.stubEnv('NODE_ENV', ...)` to flip the
 * matrix. Cookie name + `secure` flag both derive from `NODE_ENV` at
 * call time (NOT module-init) so test stubs take effect.
 *
 * NOTE on Next 15 cookies API: `cookies()` from `next/headers` is async.
 * Helpers that touch it MUST be `async`. Route-handler variants accept
 * the `NextRequest`/`NextResponse` objects directly to avoid the
 * `next/headers` import at the API-route boundary.
 */
import 'server-only';

import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';

/** Stable identifier for the dev cookie name (host-only). */
const COOKIE_NAME_DEV = 'regwatch.active-org';

/** Stable identifier for the prod cookie name (`__Secure-` prefix). */
const COOKIE_NAME_PROD = '__Secure-regwatch.active-org';

/**
 * Resolve the cookie name from `NODE_ENV` at call time.
 *
 * Exported as a function (not a const) so test environments can flip
 * `NODE_ENV` via `vi.stubEnv` between cases — see foot-gun
 * `regwatch/footguns/node-env-readonly`.
 */
export function getActiveOrgCookieName(): string {
  return process.env.NODE_ENV === 'production' ? COOKIE_NAME_PROD : COOKIE_NAME_DEV;
}

/**
 * Cookie attributes used on every `Set-Cookie` for the active-org cookie.
 *
 * - `httpOnly`: no JS access → no XSS leak.
 * - `sameSite: 'lax'`: same-origin nav + form POST work; CSRF-safe.
 * - `secure`: prod only (dev served over http://localhost).
 * - `path: '/'`: visible to every route in the web origin.
 * - No `maxAge` / `expires`: session cookie, dies with the browser
 *   session — matches the `authjs.session-token` lifetime.
 */
export interface ActiveOrgCookieOptions {
  readonly httpOnly: true;
  readonly sameSite: 'lax';
  readonly secure: boolean;
  readonly path: '/';
}

export function getActiveOrgCookieOptions(): ActiveOrgCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
}

/**
 * Read the active-org cookie from a `NextRequest` (route handlers,
 * middleware). Returns `null` when absent.
 */
export function getActiveOrgIdFromRequest(req: NextRequest): string | null {
  return req.cookies.get(getActiveOrgCookieName())?.value ?? null;
}

/**
 * Read the active-org cookie from RSC / server actions / route handlers
 * via `next/headers`. Async per Next 15 cookies API.
 */
export async function getActiveOrgIdFromCookies(): Promise<string | null> {
  const store = await cookies();
  return store.get(getActiveOrgCookieName())?.value ?? null;
}

/**
 * Write the active-org cookie via `next/headers`. ONLY usable in route
 * handlers and server actions (Next 15 forbids cookie writes from pure
 * RSC). Throws the underlying Next error if called from a read-only
 * context — that surface is loud by design.
 */
export async function setActiveOrgIdCookie(orgId: string): Promise<void> {
  const store = await cookies();
  store.set(getActiveOrgCookieName(), orgId, getActiveOrgCookieOptions());
}

/**
 * Clear the active-org cookie (sign-out, switch-to-invalid). Same write
 * constraints as `setActiveOrgIdCookie`.
 */
export async function clearActiveOrgIdCookie(): Promise<void> {
  const store = await cookies();
  store.delete(getActiveOrgCookieName());
}

/**
 * Variant for route handlers that already hold a `NextResponse` — sets
 * the cookie on the response object directly (avoids the `next/headers`
 * async overhead and works in any handler shape).
 */
export function setActiveOrgIdCookieOnResponse(res: NextResponse, orgId: string): void {
  res.cookies.set({
    name: getActiveOrgCookieName(),
    value: orgId,
    ...getActiveOrgCookieOptions(),
  });
}

/**
 * Response-side clear for parity with `setActiveOrgIdCookieOnResponse`.
 */
export function clearActiveOrgIdCookieOnResponse(res: NextResponse): void {
  res.cookies.delete(getActiveOrgCookieName());
}
