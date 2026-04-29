/**
 * Server action for `/accept/[token]` — accept a pending invitation.
 *
 * Spec: `sdd/org-invitations/spec`
 *   - R-Invitation-Accept (200 → `{orgId, role}`; 401 unauthenticated;
 *     403 EMAIL_MISMATCH; 410 INVITATION_<ACCEPTED|REVOKED|EXPIRED>;
 *     404 INVITATION_NOT_FOUND; idempotent on same-user re-accept).
 *
 * Design: `sdd/org-invitations/design` §0 D11 (accept action sets
 *   active-org cookie + `revalidatePath('/', 'layout')`).
 *
 * Why direct upstream (NOT the proxy route + apiFetch):
 *   - Server actions cannot drive `useSession().update({})` (React hook).
 *   - The accept proxy route is for client-side refreshes; the action
 *     uses {@link apiServerFetch} with the Bearer JWT directly. The
 *     client component (`<AcceptInvitationButton>`) handles
 *     `session.update({})` BEFORE navigating, mirroring the
 *     `leaveOrgAction` / `<LeaveOrgButton>` split.
 *
 * STALE_MEMBERSHIPS path: surfaced as `code: 'STALE_MEMBERSHIPS'`. The
 * client refreshes the session and prompts the user to retry. Same
 * pattern as `leaveOrgAction`.
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
 * Wire shape of `POST /invitations/:token/accept` (subset surfaced to UI).
 */
export interface AcceptInvitationWire {
  orgId: string;
  role: Role;
}

/**
 * Result envelope for {@link acceptInvitationAction}. `orgId` + `role`
 * are present on success; on error the code branches the UI surface.
 */
export interface AcceptInvitationResult {
  ok: boolean;
  orgId?: string;
  role?: Role;
  error?: string;
  code?:
    | 'STALE_MEMBERSHIPS'
    | 'EMAIL_MISMATCH'
    | 'INVITATION_NOT_FOUND'
    | 'INVITATION_REVOKED'
    | 'INVITATION_EXPIRED'
    | 'INVITATION_ACCEPTED'
    | 'UNAUTHENTICATED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'BAD_REQUEST'
    | 'UNKNOWN';
}

async function translateAcceptError(res: Response): Promise<AcceptInvitationResult> {
  if (await isStaleMembershipsResponse(res)) {
    return { ok: false, code: 'STALE_MEMBERSHIPS', error: 'Session is stale' };
  }
  let body: { code?: string; message?: string } = {};
  try {
    body = (await res.clone().json()) as { code?: string; message?: string };
  } catch {
    /* non-JSON */
  }
  const message = body.message ?? `Request failed (${res.status})`;
  const knownCodes: ReadonlyArray<NonNullable<AcceptInvitationResult['code']>> = [
    'EMAIL_MISMATCH',
    'INVITATION_NOT_FOUND',
    'INVITATION_REVOKED',
    'INVITATION_EXPIRED',
    'INVITATION_ACCEPTED',
  ];
  if (typeof body.code === 'string') {
    const c = body.code as NonNullable<AcceptInvitationResult['code']>;
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
 * `POST /invitations/:token/accept` — accept a pending invitation.
 *
 * On success: writes the active-org cookie to the new orgId, revalidates
 * the dashboard layout, returns `{ ok: true, orgId, role }`. The client
 * component MUST call `session.update({})` before navigating so the JWT
 * carries the new membership.
 *
 * Note: `orgId` is NOT passed as `X-Org-Id` — the upstream route is
 * `@PublicScope()` (auth required, no OrgScopeGuard). Sending a stale
 * X-Org-Id from the client cookie is harmless (the decorator skips the
 * guard) but we omit it for clarity.
 */
export async function acceptInvitationAction(token: string): Promise<AcceptInvitationResult> {
  try {
    const res = await apiServerFetch(`/invitations/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
    });
    if (!res.ok) return await translateAcceptError(res);
    const body = (await res.json()) as AcceptInvitationWire;
    await setActiveOrgIdCookie(body.orgId);
    revalidatePath('/', 'layout');
    return { ok: true, orgId: body.orgId, role: body.role };
  } catch (err) {
    if (err instanceof ApiServerUnauthenticatedError) {
      return { ok: false, code: 'UNAUTHENTICATED', error: err.message };
    }
    throw err;
  }
}
