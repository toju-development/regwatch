/**
 * Module-level registry for the NextAuth `session.update` function.
 *
 * Spec: `sdd/org-members/spec` § R-Jwt-Invalidate-Cross-User
 *   "Client retries via update({}) and succeeds".
 * Design: `sdd/org-members/design` §6 (apiFetch retry).
 *
 * ─────────────────────────────────────────────────────────────────
 *  Why this module exists (deviation note)
 * ─────────────────────────────────────────────────────────────────
 * The design's example code shows:
 *
 *   const session = await getSession();
 *   await session?.update?.({});
 *
 * In practice `getSession()` from `next-auth/react` (v5 beta.31) returns
 * `Session | null` — a plain object with NO `.update` method. The only
 * supplier of `update` is the React hook `useSession()`, which lives
 * inside the component tree.
 *
 * `apiFetch` is called from React contexts (server actions invoked via
 * `'use client'` components, event handlers in client components), so the
 * cleanest contract is:
 *
 *   1. A small client wiring component (`<ActiveOrgProvider>`) takes the
 *      `update` function from `useSession()` and registers it here on
 *      mount.
 *   2. `apiFetch` calls `triggerSessionUpdate()` which delegates to the
 *      registered function.
 *
 * Two critical foot-guns are encoded in the implementation:
 *
 * - **#670 — `update({})` not `update()`**. The empty-object literal is
 *   MANDATORY: `update()` with no arg only triggers a `GET /api/auth/session`
 *   refetch and does NOT re-mint the JWT. We always pass `{}`.
 *
 * - **No-op when unregistered**. If `apiFetch` runs before any client tree
 *   mounted (theoretical — its own hydration gate prevents it in practice),
 *   `triggerSessionUpdate()` resolves silently. The retry will then see the
 *   same stale JWT and the second-401 path correctly throws
 *   `StaleMembershipsError`. We do NOT throw here because the registry
 *   absence is a wiring bug, not a per-request runtime concern.
 */
'use client';

type SessionUpdater = (data?: unknown) => Promise<unknown>;

let updater: SessionUpdater | null = null;

/**
 * Register the React `session.update` function with the module. Called
 * from a client component (currently `<ActiveOrgProvider>`) inside an
 * effect so the registration happens after `<SessionProvider>` mounts.
 *
 * Idempotent: subsequent registrations replace the previous reference.
 * Pass `null` from a cleanup effect to clear (rarely needed — the
 * provider lives for the dashboard subtree's lifetime).
 */
export function registerSessionUpdater(fn: SessionUpdater | null): void {
  updater = fn;
}

/**
 * Test hook — returns the currently-registered updater (or `null`).
 * Not exported from the package surface; used by unit tests only.
 */
export function __getSessionUpdater(): SessionUpdater | null {
  return updater;
}

/**
 * Trigger a NextAuth session re-mint by calling the registered updater
 * with the empty-object argument (foot-gun #670). Resolves to `void` on
 * success, or silently no-ops when no updater is registered (the caller
 * — `apiFetch` — handles second-401 via `StaleMembershipsError`).
 */
export async function triggerSessionUpdate(): Promise<void> {
  if (!updater) return;
  // ⚠️ #670: pass `{}` — `update()` with no arg only refetches and does
  // NOT trigger `jwt({ trigger: 'update' })`. Empty object is mandatory.
  await updater({});
}
