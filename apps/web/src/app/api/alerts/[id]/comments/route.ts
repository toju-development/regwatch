/**
 * PROXY route handler — `GET|POST /api/alerts/[id]/comments`.
 *
 * Spec: sdd/alert-collaboration/spec — api-alerts domain.
 * GET  → `apps/api GET  /alerts/:id/comments` (cursor-paginated)
 * POST → `apps/api POST /alerts/:id/comments` (create comment)
 *
 * NO `pnpm build` after changes (project rule).
 */
import { NextRequest, NextResponse } from 'next/server';

import { proxyToApi } from '@/lib/proxy-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const search = req.nextUrl.search;
  return proxyToApi(req, `/alerts/${encodeURIComponent(id)}/comments${search}`, { method: 'GET' });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyToApi(req, `/alerts/${encodeURIComponent(id)}/comments`, { method: 'POST' });
}
