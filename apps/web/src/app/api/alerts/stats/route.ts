/**
 * PROXY route handler — `GET /api/alerts/stats`.
 *
 * Spec: sdd/dashboard-mvp/spec — web/api domain.
 * Forwards GET to `apps/api GET /alerts/stats`.
 * Auth + org-scope handled by proxyToApi.
 *
 * NO `pnpm build` after changes (project rule).
 */
import { NextRequest, NextResponse } from 'next/server';

import { proxyToApi } from '@/lib/proxy-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  return proxyToApi(req, '/alerts/stats', { method: 'GET' });
}
