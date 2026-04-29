/**
 * PUBLIC PROXY route handler — `GET /api/invitations/[token]`.
 *
 * Spec: `sdd/org-invitations/spec` § R-Invitation-Preview
 *   - `@Public()` upstream — no JWT, no `X-Org-Id`.
 *   - 200 returns ONLY display-safe fields `{orgName, orgSlug, inviterName,
 *     role, expiresAt, status}`. NEVER id/email/orgId.
 *   - 410 INVITATION_<ACCEPTED|REVOKED|EXPIRED> for non-PENDING.
 *   - 404 INVITATION_NOT_FOUND on unknown token.
 *   - Cache-Control: no-store.
 * Design: `sdd/org-invitations/design` §0 D6 (middleware allowlist) + D7 (proxy structure).
 *
 * Why a separate public-proxy route handler instead of fetching API directly
 * from the RSC:
 *   1. Single allow-listed origin for browser-side preview refreshes
 *      (RSC also fetches API directly per design §1, but client refresh
 *       lives behind a same-origin route to avoid CORS at runtime).
 *   2. Centralizes `Cache-Control` mirroring + `no-store` enforcement.
 *   3. Lets the middleware allowlist anchor on a single same-origin path.
 *
 * Differences vs the authed proxies in this slice:
 *   - Does NOT read or forward the session cookie.
 *   - Does NOT attach `Authorization` or `X-Org-Id`.
 *   - Direct `fetch(API_URL + '/invitations/<token>', ...)` — see foot-gun
 *     `cold-route-stale-jwt-race`: anonymous call MUST NOT inherit the
 *     JWT from the request (would defeat the @Public contract upstream
 *     and could incorrectly trigger MembershipFreshnessGuard 401).
 *
 * Middleware allowlist: `apps/web/src/middleware.ts` MUST bypass auth
 * redirect for `/api/invitations/<token>` GET (no /accept suffix).
 * See foot-gun #9 (middleware allowlist regex precedence).
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ token: string }> };

function getApiBaseUrl(): string {
  // Match `proxy-fetch.ts:getApiBaseUrl` semantics — read at call time so
  // `vi.stubEnv('API_URL', ...)` in tests takes effect, and refuse to fall
  // back to a default URL (would mask misconfigured deploys).
  const url = process.env.API_URL;
  if (!url) {
    throw new Error(
      'PROXY: process.env.API_URL is not set. Configure it via apps/web/.env.example.',
    );
  }
  return url.replace(/\/+$/, '');
}

export async function GET(_req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const { token } = await ctx.params;
  const url = `${getApiBaseUrl()}/invitations/${encodeURIComponent(token)}`;

  const upstream = await fetch(url, {
    method: 'GET',
    // Refuse Next caching — preview status (PENDING/ACCEPTED/REVOKED/EXPIRED)
    // is computed at request time and MUST reflect the current DB state.
    cache: 'no-store',
  });

  // Preview is always JSON-bodied (200/404/410). No null-body branch needed,
  // but we mirror the authed proxy's status/body/Cache-Control plumbing.
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      ...(upstream.headers.get('Cache-Control')
        ? { 'Cache-Control': upstream.headers.get('Cache-Control')! }
        : { 'Cache-Control': 'no-store' }),
    },
  });
}
