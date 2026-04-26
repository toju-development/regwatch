/**
 * Next.js 15 edge middleware — gates all protected routes via direct HS256
 * verification on the Auth.js session cookie.
 *
 * Spec: `sdd/auth-authorization-guards/spec` § "Web Edge Middleware Gates
 * Protected Routes". Design §4.
 *
 * Behavior:
 *   - authenticated request → `NextResponse.next()` (passes through to handler)
 *   - unauthenticated → 302 to `/login?callbackUrl=<original-pathname-and-query>`
 *
 * Matcher denylist (default-secure: any new route is automatically protected):
 *   - `/api/auth/*`     — Auth.js handlers must run unguarded (sign-in flow)
 *   - `/api/health`     — liveness probe
 *   - `/_next/static/*` — build output
 *   - `/_next/image`    — image optimizer
 *   - `/favicon.ico`
 *   - `/login`          — must not redirect to itself
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

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const session = await readEdgeSession(req);
  if (session) return NextResponse.next();

  const url = new URL('/login', req.url);
  url.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|login).*)'],
};
