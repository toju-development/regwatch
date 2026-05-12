/**
 * PROXY route handler — `POST /api/billing/checkout`.
 *
 * Spec: `sdd/billing-stripe/spec` § 3. BillingModule — Checkout Session.
 * Design: `sdd/billing-stripe/design` § Data Flow.
 *
 * Forwards to `POST /billing/checkout` on apps/api via `proxyToApi`,
 * which attaches `Authorization: Bearer <session-jwt>` server-side.
 * The `X-Org-Id` header from the inbound request is forwarded unchanged.
 *
 * Returns the API response (201 `{ url }`) or an error (403/401/etc).
 *
 * sdd/billing-stripe POST-9 — Task 4.1.
 */
import { NextRequest, NextResponse } from 'next/server';

import { proxyToApi } from '@/lib/proxy-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  return proxyToApi(req, '/billing/checkout', { method: 'POST' });
}
