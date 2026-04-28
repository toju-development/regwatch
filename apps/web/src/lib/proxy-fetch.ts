/**
 * Server-side proxy helper used by `apps/web/src/app/api/org/*` route
 * handlers (PROXY MODE — see engram
 * `regwatch/decisions/org-membership-proxy-mode`).
 *
 * Spec: `sdd/org-membership-ux/spec` § R-Org-GetMe, R-OrgCreate,
 *   R-ApiFetch (server-side half of the wrapper).
 * Design: `sdd/org-membership-ux/design` §1 (DEVIATED — proxy mode),
 *   §6 (Authorization attachment server-side).
 *
 * Architecture (PROXY MODE):
 *   browser ── (NextAuth session cookie + X-Org-Id) ──> apps/web /api/org/*
 *                                                       │
 *                              this helper reads cookie value
 *                              and forwards as Authorization: Bearer
 *                                                       │
 *                                                       ▼
 *                                                   apps/api /org/*
 *
 * The NextAuth session cookie is the raw HS256 JWS (per `apps/web/src/
 * lib/auth.ts` `jwt.encode` override — R-Sign in capability/auth). It IS
 * the token `apps/api` validates with `jose.jwtVerify`. Therefore the
 * proxy can forward the cookie value as-is — NO re-mint needed.
 *
 * `process.env` access pattern (mirrors `edge-jwt.ts`):
 *   - Reads `process.env.API_URL` and the session cookie name from
 *     `process.env.NODE_ENV` directly. Skipping `@/env` keeps this
 *     module loadable in unit tests without booting t3-env validation
 *     (foot-gun: tests use `vi.stubEnv` and never set every required
 *     env var; importing `@/env` would crash the whole spec file).
 *   - Production runtime always has `API_URL` validated by `createWebEnv`,
 *     so the runtime check below is defensive (never trips in prod).
 */
import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';

/**
 * NextAuth v5 session cookie name. Mirrors `edge-jwt.ts:getSessionCookieName`.
 *
 * IMPORTANT: do NOT consolidate with `edge-jwt.ts` without considering
 * the edge-runtime constraint there — that file MUST stay imports-free
 * of any Node-only surface so middleware bundles cleanly. A tiny
 * 4-line duplication is the cheapest way to keep the two files
 * independent.
 */
function getSessionCookieName(): string {
  return process.env.NODE_ENV === 'production'
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';
}

/** Header name for the active-org id forwarded to `apps/api`. */
const X_ORG_ID = 'X-Org-Id';

/**
 * Resolve the upstream `apps/api` base URL at call time (NOT module init)
 * so test stubs via `vi.stubEnv('API_URL', ...)` take effect.
 *
 * Throws (500-mappable) when missing — never silently fall back to a
 * default URL because that would mask misconfigured deploys.
 */
function getApiBaseUrl(): string {
  const url = process.env.API_URL;
  if (!url) {
    throw new Error(
      'PROXY: process.env.API_URL is not set. Configure it via apps/web/.env.example.',
    );
  }
  return url.replace(/\/+$/, '');
}

/**
 * Read the raw JWT (session cookie value) from a `NextRequest`. Returns
 * `null` when absent — the caller decides whether to short-circuit with
 * 401 or continue (e.g. for `@PublicScope` routes that the API still
 * accepts unauthenticated, though none exist in this slice).
 */
export function getJwtFromRequest(req: NextRequest): string | null {
  return req.cookies.get(getSessionCookieName())?.value ?? null;
}

/**
 * Forward a request from `apps/web` route handler to `apps/api`.
 *
 * Behavior:
 *   - Builds the upstream URL as `${API_URL}${apiPath}` (callers pass
 *     paths like `/org/me`, NOT including the host).
 *   - Attaches `Authorization: Bearer <session-cookie-jwt>` server-side.
 *   - Forwards `X-Org-Id` from the inbound request when present (the
 *     `apiFetch` wrapper sets it client-side from the Zustand store).
 *   - Forwards the inbound `Content-Type` and body for non-GET requests.
 *   - Returns a `NextResponse` that pipes status + body + selected
 *     headers (`Cache-Control`, `Content-Type`) from the upstream
 *     response. Does NOT pipe `Set-Cookie` — the proxy boundary owns
 *     cookie semantics for the web origin.
 *
 * Returns a 401 `NextResponse` (without contacting the API) when the
 * session cookie is absent — this matches the contract `OrgScopeGuard`
 * would have produced anyway and saves a needless upstream hop.
 */
export async function proxyToApi(
  req: NextRequest,
  apiPath: string,
  options: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE' } = { method: 'GET' },
): Promise<NextResponse> {
  const jwt = getJwtFromRequest(req);
  if (!jwt) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const url = `${getApiBaseUrl()}${apiPath}`;
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${jwt}`);
  const orgId = req.headers.get(X_ORG_ID);
  if (orgId) headers.set(X_ORG_ID, orgId);

  // Body forwarding: GET/HEAD have no body. For other verbs, capture the
  // raw text so the upstream sees the same payload byte-for-byte. Setting
  // Content-Type (defaulting to JSON) keeps NestJS's body parser happy.
  const init: RequestInit = {
    method: options.method,
    headers,
    // Prevent Next from caching proxied responses behind the user's back.
    cache: 'no-store',
  };
  if (options.method !== 'GET') {
    init.body = await req.text();
    headers.set('Content-Type', req.headers.get('Content-Type') ?? 'application/json');
  }

  const upstream = await fetch(url, init);

  // Per the Fetch spec, statuses 204 / 205 / 304 MUST NOT have a body.
  // The `Response` (and `NextResponse`) constructor enforces this and
  // throws TypeError when given a non-null body for those codes — even
  // an empty string. We discovered this when piping `DELETE /org/:orgId/
  // members/:userId` (204) responses for slice MVP-3b3a `org-members`
  // B5; the prior `/api/org/me` proxy never tripped it because that
  // endpoint always returns 200.
  //
  // Pipe `null` for null-body statuses; otherwise read the upstream text
  // and pass it through. We deliberately consume `upstream.text()` (and
  // discard) for null-body responses too — this guarantees the
  // connection drains for all branches.
  const isNullBody = upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
  const text = await upstream.text();
  const responseInit: ResponseInit = {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      // Mirror Cache-Control verbatim — apps/api emits `no-store` on
      // /org/me per spec R-Org-GetMe, and the browser must honour it.
      ...(upstream.headers.get('Cache-Control')
        ? { 'Cache-Control': upstream.headers.get('Cache-Control')! }
        : {}),
    },
  };
  return isNullBody ? new NextResponse(null, responseInit) : new NextResponse(text, responseInit);
}
