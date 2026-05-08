/**
 * PROXY route handler — `PATCH /api/alerts/[id]/conclusion`.
 *
 * Spec: sdd/alert-collaboration/spec — api-alerts domain.
 * Forwards to `apps/api PATCH /alerts/:id/conclusion`.
 *
 * NO `pnpm build` after changes (project rule).
 */
import { NextRequest, NextResponse } from 'next/server';

import { proxyToApi } from '@/lib/proxy-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyToApi(req, `/alerts/${encodeURIComponent(id)}/conclusion`, { method: 'PATCH' });
}
