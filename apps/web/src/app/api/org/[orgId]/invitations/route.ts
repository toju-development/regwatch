/**
 * PROXY route handlers — `GET | POST /api/org/[orgId]/invitations`.
 *
 * Spec: `sdd/org-invitations/spec`
 *   - § R-Invitation-List   (GET — any role member; Cache-Control: no-store).
 *   - § R-Invitation-Issue  (POST — OWNER|ADMIN; 201 returns issued payload sans token).
 * Design: `sdd/org-invitations/design` §0 D7 (web proxy structure mirrors 3b3a),
 *   §4 (foot-gun proxy-204 not relevant here — both GET and POST return JSON).
 *
 * Forwards to `/org/:orgId/invitations` upstream via the shared `proxyToApi`
 * helper (PROXY MODE — see engram `regwatch/decisions/org-membership-proxy-mode`):
 *   - Attaches `Authorization: Bearer <session-cookie-jwt>` server-side.
 *   - Forwards `X-Org-Id` from the inbound request when present (`apiFetch`
 *     sets it client-side from the Zustand active-org store).
 *   - For POST, captures the request body as text and re-emits with the
 *     inbound `Content-Type` (default `application/json`).
 *   - Pipes upstream status, body, and `Cache-Control` verbatim.
 *
 * 401 STALE_MEMBERSHIPS pass-through: do NOT swallow or rewrite the body.
 * Browser-side `apiFetch` reads `body.code` to drive `session.update({})` +
 * single retry (foot-gun #670). The retry is idempotency-safe for POST
 * because `MembershipFreshnessGuard` rejects BEFORE the controller runs.
 *
 * Returns a 401 (without contacting upstream) when the session cookie is
 * absent — saves a needless hop and matches what `OrgScopeGuard` would
 * have produced anyway.
 */
import { NextRequest, NextResponse } from 'next/server';

import { proxyToApi } from '@/lib/proxy-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ orgId: string }> };

function upstreamPath(orgId: string): string {
  return `/org/${encodeURIComponent(orgId)}/invitations`;
}

export async function GET(req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const { orgId } = await ctx.params;
  return proxyToApi(req, upstreamPath(orgId), { method: 'GET' });
}

export async function POST(req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const { orgId } = await ctx.params;
  return proxyToApi(req, upstreamPath(orgId), { method: 'POST' });
}
