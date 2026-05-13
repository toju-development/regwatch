/**
 * Next.js 15 edge middleware — gates all protected routes via direct HS256
 * verification on the Auth.js session cookie.
 *
 * Spec: `sdd/auth-authorization-guards/spec` § "Web Edge Middleware Gates
 * Protected Routes". Design §4. Extended for `sdd/org-invitations` MVP-3b3b
 * (decision D6 — middleware allowlist for invitation public surface).
 *
 * Behavior:
 *   - public-allowlisted path → `NextResponse.next()` unconditionally.
 *   - authenticated request    → `NextResponse.next()` (passes through).
 *   - unauthenticated          → 302 to `/login?callbackUrl=<original-pathname-and-query>`.
 *
 * Matcher denylist (default-secure: any new route is automatically protected):
 *   - `/api/auth/*`     — Auth.js handlers must run unguarded (sign-in flow)
 *   - `/api/health`     — liveness probe
 *   - `/api/test/*`     — test-only endpoints (e.g. memory inbox); already
 *                         double-guarded by NODE_ENV !== 'production' AND
 *                         EMAIL_TRANSPORT === 'memory' at the route level.
 *                         Required for Magic Link e2e harness.
 *   - `/_next/static/*` — build output
 *   - `/_next/image`    — image optimizer
 *   - `/favicon.ico`
 *   - `/login`          — must not redirect to itself
 *
 * Public allowlist for invitations (B6, MVP-3b3b — D6):
 *   - `/accept/<token>`              — invitation landing page (RSC-rendered).
 *                                      Must reach unauthenticated visitors so
 *                                      they can see the org/inviter preview
 *                                      before signing in to accept.
 *   - `/api/invitations/<token>` GET — public preview proxy. Single-segment
 *                                      after `/api/invitations/` (NOT
 *                                      followed by `/accept`), to keep the
 *                                      accept proxy gated.
 *
 * What stays AUTHED inside `/api/invitations/`:
 *   - `/api/invitations/<token>/accept` — POST goes through the standard
 *                                          gated path. The accept page in B7
 *                                          calls this from an authed server
 *                                          action; an anonymous browser
 *                                          hitting this URL is correctly
 *                                          redirected to /login.
 *
 * Foot-gun #9 (middleware allowlist regex precedence): the public-path
 * predicates run BEFORE the session check. A bug here would either (a)
 * leak access to gated routes (false-positive in `isPublicPath`) or (b)
 * 302-redirect anonymous visitors AWAY from the accept landing page
 * (false-negative — silent UX break only caught by the cold E2E sweep
 * scheduled in B8). Cover both directions in unit tests.
 *
 * Edge constraints (design §2, §4): imports `next/server` and our edge-safe
 * `edge-jwt` helper only. No Prisma, no Auth.js Node-only modules, no
 * `node:crypto`. `jose` (used transitively) runs on Web Crypto.
 *
 * Deviation from design §4 file-path: Next.js 15 with a `src/` directory
 * REQUIRES middleware at `src/middleware.ts` — placing it at the project root
 * causes Next to silently ignore it.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { readEdgeSession } from '@/lib/edge-jwt';

/**
 * `/api/invitations/<token>` (public preview) — single-segment token, no
 * trailing path. Anchored start-and-end so `/api/invitations/abc/accept`
 * does NOT match (that URL stays authed).
 */
const PUBLIC_INVITATION_PREVIEW_RE = /^\/api\/invitations\/[^/]+$/;

/**
 * Predicate: pathname is on the public-invitation allowlist (D6, B6).
 * Order matters — match the most specific prefix/regex first; the catch-all
 * `/accept/` prefix LAST.
 */
export function isPublicInvitationPath(pathname: string): boolean {
  // Public preview proxy — `/api/invitations/<token>` (GET), NOT
  // `/api/invitations/<token>/accept` (which is authed). Verb-agnostic
  // here because the matcher is path-based; the upstream API enforces
  // method via Nest route handlers (404 on unknown verb).
  if (PUBLIC_INVITATION_PREVIEW_RE.test(pathname)) return true;
  // Invitation landing page. Anything under `/accept/` (e.g. `/accept/<token>`,
  // future `/accept/<token>/expired`) is intentionally public — the page itself
  // gates UI on session + preview status (see design §0 D10).
  if (pathname.startsWith('/accept/')) return true;
  return false;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // Public allowlist FIRST — must short-circuit before the session check
  // so anonymous visitors are never redirected away from `/accept/<token>`
  // or the public preview proxy. (Foot-gun #9.)
  if (isPublicInvitationPath(pathname)) return NextResponse.next();

  const session = await readEdgeSession(req);
  if (session) return NextResponse.next();

  const url = new URL('/login', req.url);
  url.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    '/((?!api/auth|api/health|api/test|_next/static|_next/image|favicon.ico|login|verify-request).*)',
  ],
};
