/**
 * PROXY route handlers — `PATCH | DELETE /api/notifications/channels/[id]`.
 *
 * Forwards to `PATCH /notifications/channels/:id` and
 * `DELETE /notifications/channels/:id` on `apps/api`.
 *
 * Used by `<NotificationChannelsSection>` in the settings UI (POST-5).
 *
 * The `X-Org-Id` header is forwarded by the browser-side `apiFetch`
 * wrapper from the Zustand store (PROXY MODE invariant).
 *
 * Spec: `sdd/settings-ui-full/spec` — PATCH and DELETE Proxy Routes.
 * Design: `sdd/settings-ui-full/design` — /api/notifications/channels/[id] route.
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
  return proxyToApi(req, `/notifications/channels/${encodeURIComponent(id)}`, {
    method: 'PATCH',
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyToApi(req, `/notifications/channels/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
