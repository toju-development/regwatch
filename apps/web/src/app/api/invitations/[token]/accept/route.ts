/**
 * AUTHED PROXY route handler — `POST /api/invitations/[token]/accept`.
 *
 * Spec: `sdd/org-invitations/spec` § R-Invitation-Accept
 *   - `@PublicScope()` upstream — JWT REQUIRED (no `X-Org-Id`).
 *   - 200 `{orgId, role}` on happy path; 200 idempotent on same-user re-accept.
 *   - 401 unauthenticated.
 *   - 403 EMAIL_MISMATCH on mismatched caller email.
 *   - 410 INVITATION_<ACCEPTED|REVOKED|EXPIRED>.
 *   - 404 INVITATION_NOT_FOUND on unknown token.
 *   - The chokepoint MembersService.createOrGet bumps `mv` ONLY on INSERT.
 * Design: `sdd/org-invitations/design` §0 D7 + §2 (data flow critical path).
 *
 * NOT public — the user must already be signed in to accept (the accept
 * landing page in B7 redirects unauthenticated users to NextAuth signin
 * with a callbackUrl back to `/accept/<token>`). The proxy reuses the
 * shared `proxyToApi` server-side helper so the JWT is forwarded as
 * `Authorization: Bearer <session-cookie-jwt>`.
 *
 * `X-Org-Id` semantics:
 *   - The accept page is OUTSIDE org scope (no active org cookie when
 *     coming from the unauth → signin → /accept/<token> flow), so
 *     `X-Org-Id` is typically absent.
 *   - `proxyToApi` forwards `X-Org-Id` ONLY when present; if a stale
 *     header rides along, the upstream `@PublicScope()` decorator skips
 *     `OrgScopeGuard` so it cannot harm authorization.
 *
 * 401 STALE_MEMBERSHIPS handling — IMPORTANT CONTRACT NOTE FOR B7:
 *   `apiFetch` will silently retry once after `session.update({})`. This
 *   is critical for the "tab B sees new org via STALE retry" e2e
 *   scenario. The B7 server action calling this proxy MUST therefore go
 *   through `apiFetch` (NOT raw `fetch`) so the retry happens. After a
 *   successful 200, B7 calls `session.update({})` AGAIN to land the new
 *   `mv` claim that includes the just-created Membership, then sets the
 *   active-org cookie + redirects (foot-gun #670 — empty object literal).
 */
import { NextRequest, NextResponse } from 'next/server';

import { proxyToApi } from '@/lib/proxy-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ token: string }> };

export async function POST(req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const { token } = await ctx.params;
  return proxyToApi(req, `/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST' });
}
