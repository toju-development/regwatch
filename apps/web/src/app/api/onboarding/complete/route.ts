/**
 * PROXY route handler — `POST /api/onboarding/complete`.
 *
 * Forwards a `PATCH /org/:orgId/settings` call to `apps/api` with
 * `{ onboardingCompletedAt: new Date().toISOString() }`.
 *
 * The `orgId` is resolved from the `X-Org-Id` header (set by the
 * browser-side `apiFetch` wrapper from the Zustand store) — same
 * pattern as all other org-scoped proxy routes.
 *
 * Spec: `sdd/onboarding-flow/spec` — "PUT marks onboarding complete".
 * Design: `sdd/onboarding-flow/design` — /api/onboarding/complete proxy.
 *
 * NO `pnpm build` after changes (project rule).
 */
import { NextRequest, NextResponse } from 'next/server';

import { proxyToApi } from '@/lib/proxy-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Resolve orgId from the X-Org-Id header (forwarded by apiFetch).
  const orgId = req.headers.get('X-Org-Id');
  if (!orgId) {
    return NextResponse.json({ error: 'X-Org-Id header is required' }, { status: 400 });
  }

  // Build a synthetic request that patches settings with the completion timestamp.
  // We create a new NextRequest so proxyToApi reads the correct body + headers.
  const upstreamPath = `/org/${encodeURIComponent(orgId)}/settings`;
  const body = JSON.stringify({ onboardingCompletedAt: new Date().toISOString() });

  const syntheticReq = new NextRequest(req.url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      // Forward auth cookie (proxyToApi reads from req.cookies).
      cookie: req.headers.get('cookie') ?? '',
      'X-Org-Id': orgId,
    },
    body,
  });

  return proxyToApi(syntheticReq, upstreamPath, { method: 'PATCH' });
}
