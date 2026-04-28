/**
 * PROXY route handler — `GET /api/org/me`.
 *
 * Spec: `sdd/org-membership-ux/spec` § R-Org-GetMe.
 * Design: §1 (PROXY MODE deviation) + §2 (api contract).
 *
 * This handler exists because the NextAuth session cookie is `httpOnly`
 * — the JWT cannot be read from client JS. The handler reads the cookie
 * server-side and forwards as `Authorization: Bearer` to apps/api.
 *
 * See engram `regwatch/decisions/org-membership-proxy-mode` for the
 * full PROXY MODE rationale.
 */
import { NextRequest, NextResponse } from 'next/server';

import { proxyToApi } from '@/lib/proxy-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  return proxyToApi(req, '/org/me', { method: 'GET' });
}
