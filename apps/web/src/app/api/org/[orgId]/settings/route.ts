/**
 * PROXY route handlers — `GET | PUT /api/org/[orgId]/settings`.
 *
 * Spec: `sdd/jurisdictions-config/spec` § R-Settings-Web-Proxy.
 * Design: `sdd/jurisdictions-config/design` §0 D10 (PROXY MODE),
 *   §2/§3 (data flows), §8 foot-gun #5 (proxy-204 — N/A here, both
 *   verbs return 200+body).
 *
 * Both verbs forward to `/org/:orgId/settings` upstream via
 * `proxyToApi`. The helper:
 *   - Attaches `Authorization: Bearer <session-cookie-jwt>` server-side
 *     (NEVER exposes the JWT to client JS — PROXY MODE invariant #666).
 *   - Forwards `X-Org-Id` from the inbound request when present.
 *   - For PUT, captures the request body as text and re-emits with the
 *     inbound `Content-Type` (defaulting to `application/json`).
 *   - Pipes upstream status + body verbatim, including `Cache-Control:
 *     no-store` which apps/api emits on both verbs per spec.
 *
 * 401 STALE_MEMBERSHIPS pass-through: the structured body
 * `{ code: 'STALE_MEMBERSHIPS' }` is piped through unchanged. The
 * browser-side `apiFetch` wrapper detects the code and triggers
 * `session.update({})` + a single retry (foot-gun #670). The PROXY
 * MUST NOT swallow or rewrite that body — same contract as the
 * org-members and org-invitations proxies.
 *
 * No public scope here — settings are always org-scoped + authed.
 */
import { NextRequest, NextResponse } from 'next/server';

import { proxyToApi } from '@/lib/proxy-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ orgId: string }> };

function upstreamPath(orgId: string): string {
  return `/org/${encodeURIComponent(orgId)}/settings`;
}

export async function GET(req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const { orgId } = await ctx.params;
  // `orgId` flows from the URL; the API also re-validates it against
  // the session JWT memberships via `OrgScopeGuard` (defense in depth).
  return proxyToApi(req, upstreamPath(orgId), { method: 'GET' });
}

export async function PUT(req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const { orgId } = await ctx.params;
  return proxyToApi(req, upstreamPath(orgId), { method: 'PUT' });
}
