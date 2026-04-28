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
 * SSRF hardening (Copilot PR #3 follow-up):
 *   - These actions DO NOT self-HTTP back to local route handlers under
 *     `/api/org/*`. The previous implementation built a self URL from
 *     the inbound `Host` header, which is client-controllable in many
 *     deploy topologies (no upstream Host pinning) and opens an SSRF
 *     vector. It also added a needless extra hop.
 *   - `switchActiveOrg` now writes the active-org cookie directly via
 *     `setActiveOrgIdCookie` (the `/api/org/switch` handler is web-only
 *     anyway — we just inline its single side effect here).
 *   - `createOrgAction` calls the upstream `apps/api` directly using
 *     the trusted `process.env.API_URL` and attaches `Authorization:
 *     Bearer <jwt>` from the NextAuth session cookie. The PROXY MODE
 *     decision (`regwatch/decisions/org-membership-proxy-mode`) is
 *     about CLIENT → server traffic; SERVER → server is not subject to
 *     the httpOnly-cookie constraint and skipping the self-hop is both
 *     safer and faster.
 *
 * The `createOrgAction` does NOT call NextAuth `update()` itself —
 * that MUST run on the client (it is a hook concern). The action
 * returns the new org so the client can `await update()` then call
 * `switchActiveOrg(new.id)`.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import { auth } from '@/lib/auth';
import { setActiveOrgIdCookie } from '@/lib/active-org-cookie';

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
 * NextAuth v5 session cookie name. Mirrors `proxy-fetch.ts` /
 * `edge-jwt.ts` — duplicated intentionally to keep the server-action
 * module free of the edge-runtime / `server-only` boundary constraints
 * those files enforce.
 */
function getSessionCookieName(): string {
  return process.env.NODE_ENV === 'production'
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';
}

/**
 * Resolve the trusted upstream `apps/api` base URL at call time. NEVER
 * derived from request headers (no `Host`-based self URLs — see SSRF
 * hardening note in the file header).
 */
function getApiBaseUrl(): string {
  const url = process.env.API_URL;
  if (!url) {
    throw new Error(
      'createOrgAction: process.env.API_URL is not set. Configure it via apps/web/.env.example.',
    );
  }
  return url.replace(/\/+$/, '');
}

/**
 * Validate that the requested org is in the current session's
 * memberships, then write the HttpOnly active-org cookie directly.
 * Revalidate the RSC tree so the new active org propagates.
 *
 * Inlines what `/api/org/switch` did: that handler is web-only (no
 * upstream `apps/api` hop) and only has one side effect — set the
 * cookie. Doing it here removes a self-HTTP round trip and the
 * `Host`-header SSRF vector.
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

  await setActiveOrgIdCookie(orgId);

  // Force the RSC tree to re-resolve memberships + active org.
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Create a new organization by calling `apps/api POST /org` directly
 * from the server action — bypassing the local `/api/org` proxy
 * handler to avoid a self-HTTP hop and the `Host`-header SSRF vector.
 *
 * Auth: forwards the NextAuth session cookie value as a Bearer token
 * (the cookie value IS the raw HS256 JWS — see `proxy-fetch.ts`).
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

  const cookieStore = await cookies();
  const jwt = cookieStore.get(getSessionCookieName())?.value;
  if (!jwt) return { ok: false, error: 'unauthenticated' };

  const url = `${getApiBaseUrl()}/org`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
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
