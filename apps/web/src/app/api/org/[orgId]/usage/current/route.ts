/**
 * PROXY route handler — `GET /api/org/[orgId]/usage/current`.
 *
 * Spec: `sdd/scanner-vertical-ar/spec` § R-12-UsageReadEndpoint,
 *   § R-13-UsageWidget S3 ("Widget proxy hits PROXY route, not API
 *   directly").
 * Design: `sdd/scanner-vertical-ar/design` § ADR-12 (web widget).
 *
 * Mirrors `apps/web/src/app/api/org/[orgId]/settings/route.ts` exactly:
 * forwards to `/org/:orgId/usage/current` upstream via `proxyToApi`,
 * which attaches `Authorization: Bearer <session-cookie-jwt>` server-
 * side (PROXY MODE invariant #666 — JWT MUST never reach client JS),
 * forwards `X-Org-Id` from the inbound request, and pipes upstream
 * status + body + `Cache-Control: no-store` (apps/api emits this on the
 * GET handler per INV-UT-2 — "Helper and endpoint always read fresh
 * from DB; no caching MVP-5").
 *
 * Currently unused by the RSC page (which uses `apiServerFetch` direct,
 * per ADR-12 "RSC: NOT proxy from RSC"). Foundation for the future
 * client-side refresh button + 60s poll loop (deferred MVP-5; see
 * ADR-12 "manual refresh button MVP-5; no SSE/poll loop").
 *
 * 401 STALE_MEMBERSHIPS pass-through: the proxy MUST pipe the
 * `{ code: 'STALE_MEMBERSHIPS' }` body unchanged so the browser-side
 * `apiFetch` wrapper can detect it and trigger `session.update({})` +
 * a single retry (foot-gun #670). This is identical to every other
 * org-scoped proxy in apps/web.
 *
 * GET-only — there is no PUT/PATCH on usage (read-only metric; writes
 * are owned EXCLUSIVELY by `apps/scanner` per INV-SP-1).
 */
import { NextRequest, NextResponse } from 'next/server';

import { proxyToApi } from '@/lib/proxy-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ orgId: string }> };

function upstreamPath(orgId: string): string {
  return `/org/${encodeURIComponent(orgId)}/usage/current`;
}

export async function GET(req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const { orgId } = await ctx.params;
  // `orgId` flows from the URL; the API also re-validates it against
  // the session JWT memberships via `OrgScopeGuard` + the controller's
  // `assertOrgScope` defense-in-depth (B6 controller).
  return proxyToApi(req, upstreamPath(orgId), { method: 'GET' });
}
