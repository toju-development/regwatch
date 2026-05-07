/**
 * Server Actions for `/alerts/[id]`.
 *
 * Spec: sdd/alert-collaboration/spec — web-alerts domain.
 * Design: Server Actions call apiServerFetch directly (NOT a self-HTTP
 *   hop to /api/alerts/*). Auth token read from session cookie.
 *   Active org resolved from memberships cookie (same pattern as
 *   other server actions in this project).
 *
 * All actions return { ok: true, data } | { ok: false, error: string }.
 *
 * NO `pnpm build` after changes (project rule).
 */
'use server';

import type { MembershipClaim, AlertStatus } from '@regwatch/types';

import { auth } from '@/lib/auth';
import { resolveActiveOrg } from '@/lib/active-org-resolve';
import { apiServerFetch, ApiServerUnauthenticatedError } from '@/lib/api-server';

// ─── Result envelope ──────────────────────────────────────────────────────────

export interface ActionSuccess<T = unknown> {
  ok: true;
  data: T;
}

export interface ActionError {
  ok: false;
  error: string;
}

export type ActionResult<T = unknown> = ActionSuccess<T> | ActionError;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOrgId(): Promise<string | null> {
  const session = await auth();
  const memberships = ((session?.user as unknown as { memberships?: MembershipClaim[] })
    ?.memberships ?? []) as ReadonlyArray<MembershipClaim>;
  const { activeOrgId } = await resolveActiveOrg(memberships);
  return activeOrgId;
}

async function handleResponse(res: Response): Promise<ActionResult> {
  if (res.status === 204) return { ok: true, data: null };
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, data: body };
  const message =
    (body as { message?: string }).message ??
    (body as { error?: string }).error ??
    `Request failed (${res.status})`;
  return { ok: false, error: message };
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Transition alert status through the state machine.
 * PATCH /alerts/:id/status
 */
export async function transitionAlert(
  alertId: string,
  status: AlertStatus,
  note?: string,
): Promise<ActionResult> {
  const orgId = await getOrgId();
  if (!orgId) return { ok: false, error: 'No active organization' };
  try {
    const res = await apiServerFetch(`/alerts/${encodeURIComponent(alertId)}/status`, {
      method: 'PATCH',
      orgId,
      body: { status, ...(note ? { note } : {}) },
    });
    return handleResponse(res);
  } catch (err) {
    if (err instanceof ApiServerUnauthenticatedError) return { ok: false, error: err.message };
    throw err;
  }
}

/**
 * Assign (or unassign) the alert to an org member.
 * PATCH /alerts/:id/assignee
 */
export async function assignAlert(
  alertId: string,
  assigneeId: string | null,
): Promise<ActionResult> {
  const orgId = await getOrgId();
  if (!orgId) return { ok: false, error: 'No active organization' };
  try {
    const res = await apiServerFetch(`/alerts/${encodeURIComponent(alertId)}/assignee`, {
      method: 'PATCH',
      orgId,
      body: { assigneeId },
    });
    return handleResponse(res);
  } catch (err) {
    if (err instanceof ApiServerUnauthenticatedError) return { ok: false, error: err.message };
    throw err;
  }
}

/**
 * Set or update the conclusion text. OWNER/ADMIN only.
 * PATCH /alerts/:id/conclusion
 */
export async function concludeAlert(alertId: string, conclusion: string): Promise<ActionResult> {
  const orgId = await getOrgId();
  if (!orgId) return { ok: false, error: 'No active organization' };
  try {
    const res = await apiServerFetch(`/alerts/${encodeURIComponent(alertId)}/conclusion`, {
      method: 'PATCH',
      orgId,
      body: { conclusion },
    });
    return handleResponse(res);
  } catch (err) {
    if (err instanceof ApiServerUnauthenticatedError) return { ok: false, error: err.message };
    throw err;
  }
}

/**
 * Add a comment to an alert.
 * POST /alerts/:id/comments
 */
export async function addComment(
  alertId: string,
  body: string,
  parentId?: string,
): Promise<ActionResult> {
  const orgId = await getOrgId();
  if (!orgId) return { ok: false, error: 'No active organization' };
  try {
    const res = await apiServerFetch(`/alerts/${encodeURIComponent(alertId)}/comments`, {
      method: 'POST',
      orgId,
      body: { body, ...(parentId ? { parentId } : {}) },
    });
    return handleResponse(res);
  } catch (err) {
    if (err instanceof ApiServerUnauthenticatedError) return { ok: false, error: err.message };
    throw err;
  }
}

/**
 * Delete a comment. OWNER/ADMIN can delete any; ANALYST can delete own only.
 * DELETE /alerts/:id/comments/:cid
 */
export async function deleteComment(alertId: string, commentId: string): Promise<ActionResult> {
  const orgId = await getOrgId();
  if (!orgId) return { ok: false, error: 'No active organization' };
  try {
    const res = await apiServerFetch(
      `/alerts/${encodeURIComponent(alertId)}/comments/${encodeURIComponent(commentId)}`,
      { method: 'DELETE', orgId },
    );
    return handleResponse(res);
  } catch (err) {
    if (err instanceof ApiServerUnauthenticatedError) return { ok: false, error: err.message };
    throw err;
  }
}
