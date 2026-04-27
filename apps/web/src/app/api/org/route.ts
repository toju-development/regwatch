/**
 * PROXY route handler — `POST /api/org`.
 *
 * Spec: `sdd/org-membership-ux/spec` § R-OrgCreate.
 * Design: §1 (PROXY MODE deviation) + §2 (api contract).
 *
 * Forwards the request body verbatim to `apps/api POST /org`. Body
 * validation lives on the API side (Zod pipe in OrganizationsController).
 *
 * See engram `regwatch/decisions/org-membership-proxy-mode`.
 */
import { NextRequest, NextResponse } from 'next/server';

import { proxyToApi } from '@/lib/proxy-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  return proxyToApi(req, '/org', { method: 'POST' });
}
