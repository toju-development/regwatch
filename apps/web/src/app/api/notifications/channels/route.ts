/**
 * PROXY route handlers — `GET | POST /api/notifications/channels`.
 *
 * Forwards to `GET /notifications/channels` and `POST /notifications/channels`
 * on `apps/api`. Used by `<NotificationChannelForm>` in the onboarding
 * wizard (Phase 3, MVP-11) and by future POST-5 settings UI.
 *
 * The `X-Org-Id` header is forwarded by the browser-side `apiFetch`
 * wrapper from the Zustand store (PROXY MODE invariant #666).
 *
 * Spec: `sdd/onboarding-flow/spec` — NotificationChannelForm proxy.
 * Design: `sdd/onboarding-flow/design` — /api/notifications/channels route.
 *
 * NO `pnpm build` after changes (project rule).
 */
import { NextRequest, NextResponse } from 'next/server';

import { proxyToApi } from '@/lib/proxy-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPSTREAM_PATH = '/notifications/channels';

export async function GET(req: NextRequest): Promise<NextResponse> {
  return proxyToApi(req, UPSTREAM_PATH, { method: 'GET' });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return proxyToApi(req, UPSTREAM_PATH, { method: 'POST' });
}
