/**
 * PROXY route handler — `GET /api/org/[orgId]/members`.
 *
 * Spec: `sdd/org-members/spec` § R-Members-List (PROXY MODE invariant).
 * Design: `sdd/org-members/design` §6 (web routing) + decision Q7 (web
 *   routing via existing `proxy-fetch.ts`).
 *
 * Forwards the inbound request to the API at `/org/:orgId/members`.
 * `proxyToApi` attaches `Authorization: Bearer <session-cookie-jwt>`
 * server-side and pipes upstream status, body, and `Cache-Control`
 * verbatim. The API emits `Cache-Control: no-store` on this list per
 * R-Members-List, so the browser receives that header faithfully.
 *
 * 401 STALE_MEMBERSHIPS pass-through: when the API's
 * `MembershipFreshnessGuard` rejects with 401 + structured body
 * `{ code: 'STALE_MEMBERSHIPS' }`, this handler simply pipes that
 * response through. The browser-side `apiFetch` wrapper detects the
 * code and triggers `session.update({})` + a single retry (foot-gun
 * #670). DO NOT swallow or rewrite that body here.
 *
 * See engram `regwatch/decisions/org-membership-proxy-mode` for the
 * PROXY MODE rationale.
 */
import { NextRequest, NextResponse } from 'next/server';

import { proxyToApi } from '@/lib/proxy-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  const { orgId } = await params;
  // `orgId` flows from the URL; the API also re-validates it against
  // the session JWT memberships via `OrgScopeGuard` (defense in depth).
  // No client-side trust assumption — the proxy is just a transport hop.
  return proxyToApi(req, `/org/${encodeURIComponent(orgId)}/members`, { method: 'GET' });
}
