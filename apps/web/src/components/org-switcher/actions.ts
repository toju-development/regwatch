/**
 * Server actions for the org switcher.
 *
 * Spec: `sdd/org-membership-ux/spec` § R-Switcher scenarios "Two
 *   memberships → dropdown switch" + "Create-new-org affordance",
 *   § R-Jwt-Refresh-OnSelfCreate.
 * Design: §4 ("Switch action" + "Create action").
 *
 * Why server actions (not client `apiFetch` directly):
 *   - `revalidatePath('/', 'layout')` MUST run server-side after a
 *     cookie write so the RSC tree picks up the new active org. Calling
 *     it from a server action is the canonical Next 15 pattern.
 *   - Centralises the "validate orgId ∈ memberships" decision in a
 *     trusted context.
 *
 * The `createOrgAction` does NOT call NextAuth `update()` itself —
 * that MUST run on the client (it is a hook concern). The action
 * returns the new org so the client can `await update()` then call
 * `switchActiveOrg(new.id)`.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { headers, cookies } from 'next/headers';

import { auth } from '@/lib/auth';
import { getActiveOrgCookieName } from '@/lib/active-org-cookie';

interface CreateOrgResult {
  ok: boolean;
  org?: { id: string; name: string; slug: string };
  error?: string;
}

interface SwitchResult {
  ok: boolean;
  error?: string;
}

/**
 * Build an absolute URL for fetching our own route handlers from a
 * server action. Server actions don't have a `Request` object; we read
 * the inbound `host` header (always present in Next route contexts).
 *
 * Forwards the active session cookie so the proxy / switch handler
 * can `auth()` and read the JWT.
 */
async function buildSelfUrl(path: string): Promise<{ url: string; cookieHeader: string }> {
  const h = await headers();
  const host = h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const url = `${proto}://${host}${path}`;
  const c = await cookies();
  const cookieHeader = c
    .getAll()
    .map((entry) => `${entry.name}=${entry.value}`)
    .join('; ');
  return { url, cookieHeader };
}

/**
 * Validate that the requested org is in the current session's
 * memberships, then POST to the local `/api/org/switch` handler so the
 * HttpOnly cookie is written on the response. Revalidate the RSC tree
 * so the new active org propagates.
 */
export async function switchActiveOrg(orgId: string): Promise<SwitchResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'unauthenticated' };

  const memberships =
    (session.user as unknown as { memberships?: ReadonlyArray<{ organizationId: string }> })
      .memberships ?? [];
  if (!memberships.some((m) => m.organizationId === orgId)) {
    return { ok: false, error: 'forbidden' };
  }

  const { url, cookieHeader } = await buildSelfUrl('/api/org/switch');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
    },
    body: JSON.stringify({ orgId }),
    cache: 'no-store',
  });
  if (res.status !== 204) {
    return { ok: false, error: `switch failed (${res.status})` };
  }

  // Force the RSC tree to re-resolve memberships + active org.
  revalidatePath('/', 'layout');
  // Also touch the cookie name so callers can verify in tests that the
  // cookie convention is in effect (not strictly required at runtime).
  void getActiveOrgCookieName();
  return { ok: true };
}

/**
 * Create a new organization via the proxy `POST /api/org`.
 *
 * After this returns successfully, the CLIENT must:
 *   1. `await update()` — refresh the NextAuth JWT (gains new membership).
 *   2. `await switchActiveOrg(result.org.id)` — set it as active.
 *
 * Both steps are client-side because `update()` is a hook.
 */
export async function createOrgAction(name: string): Promise<CreateOrgResult> {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    return { ok: false, error: 'name must be 1-80 chars' };
  }
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'unauthenticated' };

  const { url, cookieHeader } = await buildSelfUrl('/api/org');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
    },
    body: JSON.stringify({ name: trimmed }),
    cache: 'no-store',
  });
  if (res.status !== 201) {
    return { ok: false, error: `create failed (${res.status})` };
  }
  const body = (await res.json()) as { id: string; name: string; slug: string };
  return { ok: true, org: body };
}
