/**
 * PROXY route handler — `DELETE /api/alerts/[id]/comments/[cid]`.
 *
 * Spec: sdd/alert-collaboration/spec — api-alerts domain.
 * Forwards to `apps/api DELETE /alerts/:id/comments/:cid`.
 *
 * NO `pnpm build` after changes (project rule).
 */
import { NextRequest, NextResponse } from 'next/server';

import { proxyToApi } from '@/lib/proxy-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> },
): Promise<NextResponse> {
  const { id, cid } = await params;
  return proxyToApi(req, `/alerts/${encodeURIComponent(id)}/comments/${encodeURIComponent(cid)}`, {
    method: 'DELETE',
  });
}
