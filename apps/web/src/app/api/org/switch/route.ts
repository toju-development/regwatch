/**
 * Web-only route handler — `POST /api/org/switch`.
 *
 * Spec: `sdd/org-membership-ux/spec` § R-ActiveOrgCookie scenarios
 *   "Two memberships → dropdown switch", "Cookie is HttpOnly".
 * Design: §3 (cookie strategy) + §4 (switcher action).
 *
 * Unlike the other `/api/org/*` handlers, this one does NOT proxy to
 * `apps/api`. It is purely web-side: validates that the requested
 * `orgId` is in the user's session memberships and writes the HttpOnly
 * active-org cookie. The cookie cannot be set by `apps/api` because it
 * lives in the web origin (the api may not even share a domain).
 *
 * Auth: requires a valid NextAuth session. JWT memberships claim is
 * the source of truth — we do NOT re-query the DB here; the cookie
 * write is a UX-state concern, not an authorization decision (the API
 * still re-validates `X-Org-Id` against memberships on every request
 * via `OrgScopeGuard`).
 *
 * Response shape:
 *   - 204 on success (cookie set on the response).
 *   - 400 when body shape is invalid.
 *   - 401 when not authenticated.
 *   - 403 when `orgId` is not in the session memberships (defensive).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import type { MembershipClaim } from '@regwatch/types';
import { auth } from '@/lib/auth';
import { setActiveOrgIdCookieOnResponse } from '@/lib/active-org-cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SwitchBody = z.object({
  orgId: z.string().min(1),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let parsed: { orgId: string };
  try {
    const json: unknown = await req.json();
    const result = SwitchBody.safeParse(json);
    if (!result.success) {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }
    parsed = result.data;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  // Memberships landed on session.user via the `session` callback in
  // `apps/web/src/lib/auth.ts`. The shape mirrors the JWT
  // `memberships[]` claim (MembershipClaim).
  const memberships =
    (session.user as unknown as { memberships?: ReadonlyArray<MembershipClaim> }).memberships ?? [];
  const isValid = memberships.some((m) => m.organizationId === parsed.orgId);
  if (!isValid) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const response = new NextResponse(null, { status: 204 });
  setActiveOrgIdCookieOnResponse(response, parsed.orgId);
  return response;
}
