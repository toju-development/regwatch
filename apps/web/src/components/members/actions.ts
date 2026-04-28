/**
 * Server actions for `/settings/members`.
 *
 * Spec: `sdd/org-members/spec`
 *   - R-Members-List       (page-level read; no action — RSC fetches)
 *   - R-Membership-Update  ({@link updateMemberRoleAction})
 *   - R-Membership-Remove  ({@link removeMemberAction}, self-leave via
 *                           {@link leaveOrgAction})
 *   - R-Jwt-Invalidate-Cross-User (STALE_MEMBERSHIPS surface contract)
 *
 * Design: `sdd/org-members/design`
 *   - §2 (API contracts the actions wrap)
 *   - §6 (frontend integration; self-leave switches active org to
 *     personalOrg, no sign-out)
 *   - §0 #9 ("Self-leave UX flow")
 *
 * Architecture:
 *   - Direct upstream calls via {@link apiServerFetch} — NO self-HTTP
 *     hop, NO `Host`-header derivation. Aligns with the post-Copilot
 *     SSRF hardening in `apps/web/src/components/org-switcher/actions.ts`.
 *   - On success, `revalidatePath('/settings/members')` so the RSC
 *     re-fetches the members list and the dashboard layout re-resolves
 *     the active org.
 *   - Result envelope: `{ ok, error?, code? }`. `code` mirrors the API
 *     error `code` (e.g. `LAST_OWNER`, `PERSONAL_ORG_UNREMOVABLE`,
 *     `OWNER_PROMOTE_REQUIRES_OWNER`, `SELF_PROMOTE_FORBIDDEN`,
 *     `OWNER_REMOVE_REQUIRES_OWNER`, `STALE_MEMBERSHIPS`). The UI
 *     branches on `code` to render targeted toasts.
 *
 * STALE_MEMBERSHIPS handling: the server cannot drive
 * `useSession().update({})` (hook). When upstream returns
 * `401 STALE_MEMBERSHIPS`, the action returns `{ ok:false,
 * code:'STALE_MEMBERSHIPS' }` — the client component is responsible
 * for refreshing the session AND retrying / signing out (foot-gun
 * `regwatch/footguns/nextauth-v5-update-no-args-skips-post`: must call
 * `update({})`, not `update()`).
 *
 * Sign-out wiring: this module NEVER calls `signOut()` itself
 * (`signOut` from `next-auth/react` is a client hook). Sign-out lives in
 * the LeaveOrgButton / MemberRow client components when they observe a
 * persistent STALE.
 *
 * Personal-org guard: `leaveOrgAction` does NOT pre-check whether the
 * org is personal — the server is the source of truth and returns
 * `400 PERSONAL_ORG_UNREMOVABLE` (spec R-Membership-Remove S "Self-leave
 * on personalOrg → 400"). We surface that code so the UI can render a
 * "you cannot leave your personal org" message.
 */
'use server';

import { revalidatePath } from 'next/cache';

import type { Role } from '@regwatch/types';

import {
  apiServerFetch,
  isStaleMembershipsResponse,
  ApiServerUnauthenticatedError,
} from '@/lib/api-server';
import { setActiveOrgIdCookie } from '@/lib/active-org-cookie';

/**
 * Standard envelope for member-mutation actions.
 *
 * `code` echoes the API's structured error code so the UI can branch
 * deterministically (toast text, retry decisions). `error` is a
 * fallback human-readable message for shapes the API doesn't tag.
 */
export interface MembersActionResult {
  ok: boolean;
  error?: string;
  /**
   * Stable, machine-readable error code. One of:
   *   - `STALE_MEMBERSHIPS`             — JWT mv claim is older than
   *                                       live; client must
   *                                       `useSession().update({})`.
   *   - `LAST_OWNER`                    — last-OWNER guard tripped.
   *   - `PERSONAL_ORG_UNREMOVABLE`      — cannot remove from personal org.
   *   - `OWNER_PROMOTE_REQUIRES_OWNER`  — only OWNER can promote to OWNER.
   *   - `SELF_PROMOTE_FORBIDDEN`        — self-targets may only downgrade.
   *   - `OWNER_REMOVE_REQUIRES_OWNER`   — ADMIN cannot remove OWNER.
   *   - `UNAUTHENTICATED`               — no session cookie (programming bug
   *                                       at call site).
   *   - `FORBIDDEN`                     — generic 403.
   *   - `NOT_FOUND`                     — generic 404.
   *   - `BAD_REQUEST`                   — generic 400 (unknown shape).
   *   - `UNKNOWN`                       — fallback for unexpected statuses.
   */
  code?:
    | 'STALE_MEMBERSHIPS'
    | 'LAST_OWNER'
    | 'PERSONAL_ORG_UNREMOVABLE'
    | 'OWNER_PROMOTE_REQUIRES_OWNER'
    | 'SELF_PROMOTE_FORBIDDEN'
    | 'OWNER_REMOVE_REQUIRES_OWNER'
    | 'UNAUTHENTICATED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'BAD_REQUEST'
    | 'UNKNOWN';
}

/**
 * Result of {@link leaveOrgAction}. Extends the standard envelope with
 * the org we switched to (so the page can decide whether to redirect).
 */
export interface LeaveOrgResult extends MembersActionResult {
  /**
   * The org the active-org cookie was switched to AFTER a successful
   * leave. `null` when the action did not switch (e.g. failure path).
   */
  switchedTo?: string | null;
}

/**
 * Translate an upstream non-2xx response into a {@link MembersActionResult}.
 *
 * Reads the body once (clone-safe — caller has already handed us the
 * response), looks for a `code` field, and falls back to status-based
 * defaults when the API didn't tag the error.
 */
async function translateError(res: Response): Promise<MembersActionResult> {
  if (await isStaleMembershipsResponse(res)) {
    return { ok: false, code: 'STALE_MEMBERSHIPS', error: 'Session is stale' };
  }
  let body: { code?: string; message?: string } = {};
  try {
    body = (await res.clone().json()) as { code?: string; message?: string };
  } catch {
    /* non-JSON body */
  }
  const message = body.message ?? `Request failed (${res.status})`;
  const knownCodes: ReadonlyArray<NonNullable<MembersActionResult['code']>> = [
    'LAST_OWNER',
    'PERSONAL_ORG_UNREMOVABLE',
    'OWNER_PROMOTE_REQUIRES_OWNER',
    'SELF_PROMOTE_FORBIDDEN',
    'OWNER_REMOVE_REQUIRES_OWNER',
  ];
  if (typeof body.code === 'string') {
    const c = body.code as NonNullable<MembersActionResult['code']>;
    if (knownCodes.includes(c)) {
      return { ok: false, code: c, error: message };
    }
  }
  switch (res.status) {
    case 400:
      return { ok: false, code: 'BAD_REQUEST', error: message };
    case 401:
      return { ok: false, code: 'UNAUTHENTICATED', error: message };
    case 403:
      return { ok: false, code: 'FORBIDDEN', error: message };
    case 404:
      return { ok: false, code: 'NOT_FOUND', error: message };
    default:
      return { ok: false, code: 'UNKNOWN', error: message };
  }
}

/**
 * `PATCH /org/:orgId/members/:userId` — change a member's role.
 *
 * On success: revalidates the members page so the RSC re-fetches the
 * list. Returns `{ ok:true }`.
 *
 * Self-target rules (enforced server-side; we surface the codes):
 *   - Self-promote → 403 `SELF_PROMOTE_FORBIDDEN` (spec R-Membership-Update).
 *   - Self-demote (downgrade) → allowed (Q8).
 */
export async function updateMemberRoleAction(
  orgId: string,
  userId: string,
  role: Role,
): Promise<MembersActionResult> {
  try {
    const res = await apiServerFetch(
      `/org/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        orgId,
        body: { role },
      },
    );
    if (!res.ok) return await translateError(res);
    revalidatePath('/settings/members');
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiServerUnauthenticatedError) {
      return { ok: false, code: 'UNAUTHENTICATED', error: err.message };
    }
    throw err;
  }
}

/**
 * `DELETE /org/:orgId/members/:userId` — remove a member from an org.
 *
 * Used by:
 *   - The kebab/Remove control in `<MemberRow>` (admin-removes-other).
 *   - INTERNALLY by {@link leaveOrgAction} for the self-leave path —
 *     leaveOrgAction adds the active-org switch logic on top.
 *
 * Self-target restrictions enforced server-side (we surface):
 *   - Self-leave on personal org → 400 `PERSONAL_ORG_UNREMOVABLE`.
 *   - Last-OWNER → 409 `LAST_OWNER`.
 */
export async function removeMemberAction(
  orgId: string,
  userId: string,
): Promise<MembersActionResult> {
  try {
    const res = await apiServerFetch(
      `/org/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      {
        method: 'DELETE',
        orgId,
      },
    );
    if (!res.ok) return await translateError(res);
    revalidatePath('/settings/members');
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiServerUnauthenticatedError) {
      return { ok: false, code: 'UNAUTHENTICATED', error: err.message };
    }
    throw err;
  }
}

/**
 * Self-leave flow.
 *
 * Algorithm (design §0 #9):
 *   1. DELETE self from `:orgId`. Server enforces personal-org-unremovable
 *      (400 if `:orgId === personalOrgId`), last-OWNER (409), etc. Errors
 *      surface verbatim — caller decides how to render.
 *   2. If `:orgId` was the active org (the typical case — you don't
 *      usually click Leave from another org's view), switch the active
 *      org to `targetOrgId` (caller-supplied: typically the user's
 *      personal org id, resolved page-side from `/org/me`). Direct
 *      cookie write via {@link setActiveOrgIdCookie} — same rationale
 *      as `org-switcher/actions.ts switchActiveOrg` (avoid self-HTTP).
 *   3. `revalidatePath('/', 'layout')` so the dashboard layout re-resolves
 *      memberships + active org from the (now refreshed) JWT. The
 *      JWT's `mv` claim was bumped by step 1, so the `MembershipFreshnessGuard`
 *      will 401 STALE on the NEXT request from this user — a side effect
 *      of self-leave is therefore that the very next `apiFetch` call
 *      from this client will trip the STALE retry path (correct
 *      behaviour — the leaving user's claim is now out of date).
 *
 * No `signOut()` (per design): the leaving user still holds their
 * personal-org membership, so they remain authenticated. The
 * `<LeaveOrgButton>` client component handles the navigation
 * (`router.replace('/dashboard')`) AND the session update so the JWT
 * loses the now-revoked membership.
 */
export async function leaveOrgAction(
  orgId: string,
  /**
   * The leaving user's own `userId`. The upstream API has NO `/members/self`
   * shorthand — `apps/api/src/modules/members/members.controller.ts` only
   * exposes `DELETE :userId`. Caller (page / button component) MUST resolve
   * this from the NextAuth session (`session.user.id`) and pass it through;
   * the action does NOT call `auth()` itself to keep this module trivially
   * mockable in unit tests.
   */
  selfUserId: string,
  /**
   * Org id to switch the active-org cookie to AFTER successful leave.
   * Caller (page) resolves this from `/org/me` — typically the user's
   * personal org id, but could be any other surviving membership. `null`
   * skips the switch (e.g. the leaving user has no other orgs; shouldn't
   * happen post-`auto-org` invariant but defensive).
   */
  switchToOrgId: string | null,
): Promise<LeaveOrgResult> {
  try {
    const res = await apiServerFetch(
      `/org/${encodeURIComponent(orgId)}/members/${encodeURIComponent(selfUserId)}`,
      {
        method: 'DELETE',
        orgId,
      },
    );
    if (!res.ok) {
      return await translateError(res);
    }
    let switched: string | null = null;
    if (switchToOrgId !== null && switchToOrgId !== orgId) {
      await setActiveOrgIdCookie(switchToOrgId);
      switched = switchToOrgId;
    }
    revalidatePath('/', 'layout');
    return { ok: true, switchedTo: switched };
  } catch (err) {
    if (err instanceof ApiServerUnauthenticatedError) {
      return { ok: false, code: 'UNAUTHENTICATED', error: err.message, switchedTo: null };
    }
    throw err;
  }
}
