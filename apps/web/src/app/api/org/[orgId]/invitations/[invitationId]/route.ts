/**
 * PROXY route handler — `DELETE /api/org/[orgId]/invitations/[invitationId]`.
 *
 * Spec: `sdd/org-invitations/spec` § R-Invitation-Revoke
 *   - 204 on PENDING revoke.
 *   - 204 idempotent on already-REVOKED (revokedAt NOT overwritten).
 *   - 410 ALREADY_ACCEPTED on accepted invitation.
 * Design: `sdd/org-invitations/design` §0 D7 + §4 foot-gun "proxy-fetch-204-illegal".
 *
 * Foot-gun: `Response`/`NextResponse` constructor THROWS TypeError when
 * given any body (even `""`) for a 204/205/304 status. The shared
 * `proxyToApi` helper handles this by passing `null` for null-body
 * statuses (see `proxy-fetch.ts:146`). Do NOT pre-process or re-wrap
 * the upstream 204 here — it would re-trip the same foot-gun.
 *
 * 401 STALE_MEMBERSHIPS pass-through: same contract as the list/issue
 * proxy — body is piped through unchanged for `apiFetch` to detect and
 * retry once after `session.update({})`.
 */
import { NextRequest, NextResponse } from 'next/server';

import { proxyToApi } from '@/lib/proxy-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ orgId: string; invitationId: string }> };

export async function DELETE(req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const { orgId, invitationId } = await ctx.params;
  const path = `/org/${encodeURIComponent(orgId)}/invitations/${encodeURIComponent(invitationId)}`;
  return proxyToApi(req, path, { method: 'DELETE' });
}
