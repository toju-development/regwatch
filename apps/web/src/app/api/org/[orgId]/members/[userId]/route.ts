/**
 * PROXY route handlers — `PATCH | DELETE /api/org/[orgId]/members/[userId]`.
 *
 * Spec: `sdd/org-members/spec`
 *   - § R-Membership-Update (PATCH role change; PROXY MODE).
 *   - § R-Membership-Remove (DELETE; PROXY MODE; covers self-leave).
 * Design: `sdd/org-members/design` §6 (web routing) + decision Q7.
 *
 * Both verbs forward to `/org/:orgId/members/:userId` upstream via
 * `proxyToApi`. The helper:
 *   - Attaches `Authorization: Bearer <session-cookie-jwt>` server-side.
 *   - Forwards `X-Org-Id` from the inbound request when present.
 *   - For non-GET, captures the request body as text and re-emits with
 *     the inbound `Content-Type` (defaulting to `application/json`).
 *   - Pipes upstream status + body verbatim.
 *
 * 401 STALE_MEMBERSHIPS pass-through: do NOT swallow or rewrite the
 * body. Browser-side `apiFetch` reads `body.code` to decide whether to
 * retry after `session.update({})`. The retry is idempotency-safe even
 * for PATCH/DELETE because the freshness guard rejects BEFORE the
 * controller runs (spec scenario "Mutation 401-stale also surfaces").
 *
 * 204 (DELETE happy path): proxyToApi captures `Response.text()` which
 * resolves to an empty string for 204; the helper passes that through
 * with the upstream status. The browser sees a real 204.
 *
 * See engram `regwatch/decisions/org-membership-proxy-mode`.
 */
import { NextRequest, NextResponse } from 'next/server';

import { proxyToApi } from '@/lib/proxy-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ orgId: string; userId: string }> };

function upstreamPath(orgId: string, userId: string): string {
  return `/org/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`;
}

export async function PATCH(req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const { orgId, userId } = await ctx.params;
  return proxyToApi(req, upstreamPath(orgId, userId), { method: 'PATCH' });
}

export async function DELETE(req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const { orgId, userId } = await ctx.params;
  return proxyToApi(req, upstreamPath(orgId, userId), { method: 'DELETE' });
}
