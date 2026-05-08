/**
 * PROXY route handler — `GET /api/alerts`.
 *
 * Spec: sdd/alert-collaboration/spec — api-alerts domain.
 * Design: same proxy-mode as /api/org/* routes.
 *
 * Forwards GET with query params (status, assigneeId, cursor, limit)
 * to `apps/api GET /alerts`. Auth + org-scope handled by proxyToApi.
 *
 * NO `pnpm build` after changes (project rule).
 */
import { NextRequest, NextResponse } from 'next/server';

import { proxyToApi } from '@/lib/proxy-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const search = req.nextUrl.search;
  return proxyToApi(req, `/alerts${search}`, { method: 'GET' });
}
