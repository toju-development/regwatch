/**
 * @vitest-environment node
 *
 * Contract tests for `members/actions.ts`.
 *
 * Spec: `sdd/org-members/spec` — R-Membership-Update, R-Membership-Remove,
 *   R-Jwt-Invalidate-Cross-User (`STALE_MEMBERSHIPS` surface contract).
 *
 * Mocks:
 *   - `next/headers` cookies (so `apiServerFetch` finds a session token).
 *   - `next/cache` `revalidatePath` (so we can assert it ran).
 *   - `@/lib/active-org-cookie` `setActiveOrgIdCookie` (leave-org switch
 *     side effect).
 *   - global `fetch` for the upstream `apps/api` calls.
 *
 * Why `node` env: `apiServerFetch` imports `next/headers` and
 * `'server-only'` (stubbed by vitest config), neither of which behave
 * under jsdom.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const cookieGet = vi.fn();
const revalidatePath = vi.fn();
const setActiveOrgIdCookie = vi.fn();

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: cookieGet }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

vi.mock('@/lib/active-org-cookie', () => ({
  setActiveOrgIdCookie: (...args: unknown[]) => setActiveOrgIdCookie(...args),
}));

import {
  updateMemberRoleAction,
  removeMemberAction,
  leaveOrgAction,
  issueInvitationAction,
  revokeInvitationAction,
} from '../actions.js';

const fetchMock = vi.fn();

beforeEach(() => {
  cookieGet.mockReset();
  cookieGet.mockReturnValue({ value: 'jwt-token-value' });
  revalidatePath.mockReset();
  setActiveOrgIdCookie.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('API_URL', 'http://api.test');
  vi.stubEnv('NODE_ENV', 'development');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('updateMemberRoleAction', () => {
  it('PATCHes the role and revalidates on success', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const result = await updateMemberRoleAction('org-1', 'user-2', 'ADMIN');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://api.test/org/org-1/members/user-2');
    expect((init as RequestInit).method).toBe('PATCH');
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer jwt-token-value');
    expect(headers.get('X-Org-Id')).toBe('org-1');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect((init as RequestInit).body).toBe(JSON.stringify({ role: 'ADMIN' }));
    expect(revalidatePath).toHaveBeenCalledWith('/settings/members');
  });

  it('translates SELF_PROMOTE_FORBIDDEN', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { code: 'SELF_PROMOTE_FORBIDDEN', message: 'no' }),
    );
    const result = await updateMemberRoleAction('org-1', 'user-1', 'OWNER');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('SELF_PROMOTE_FORBIDDEN');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('translates OWNER_PROMOTE_REQUIRES_OWNER', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { code: 'OWNER_PROMOTE_REQUIRES_OWNER', message: 'admins cannot' }),
    );
    const result = await updateMemberRoleAction('org-1', 'user-2', 'OWNER');
    expect(result).toMatchObject({ ok: false, code: 'OWNER_PROMOTE_REQUIRES_OWNER' });
  });

  it('surfaces STALE_MEMBERSHIPS as code, not as raw 401', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { code: 'STALE_MEMBERSHIPS' }));
    const result = await updateMemberRoleAction('org-1', 'user-2', 'ADMIN');
    expect(result).toMatchObject({ ok: false, code: 'STALE_MEMBERSHIPS' });
  });

  it('falls back to status-based codes when API does not tag', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { message: 'gone' }));
    const result = await updateMemberRoleAction('org-1', 'user-2', 'ADMIN');
    expect(result).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('removeMemberAction', () => {
  it('DELETEs and revalidates on success', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const result = await removeMemberAction('org-1', 'user-2');
    expect(result).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/org/org-1/members/user-2');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('DELETE');
    expect(revalidatePath).toHaveBeenCalledWith('/settings/members');
  });

  it('translates LAST_OWNER', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { code: 'LAST_OWNER', message: 'last owner' }));
    const result = await removeMemberAction('org-1', 'owner-1');
    expect(result).toMatchObject({ ok: false, code: 'LAST_OWNER' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('translates OWNER_REMOVE_REQUIRES_OWNER', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { code: 'OWNER_REMOVE_REQUIRES_OWNER', message: 'nope' }),
    );
    const result = await removeMemberAction('org-1', 'owner-2');
    expect(result.code).toBe('OWNER_REMOVE_REQUIRES_OWNER');
  });

  it('returns UNAUTHENTICATED when no session cookie', async () => {
    cookieGet.mockReturnValue(undefined);
    const result = await removeMemberAction('org-1', 'user-2');
    expect(result).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('leaveOrgAction', () => {
  it('switches active org to personalOrgId and revalidates the layout on success', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const result = await leaveOrgAction('org-other', 'user-self', 'org-personal');

    expect(result).toEqual({ ok: true, switchedTo: 'org-personal' });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/org/org-other/members/user-self');
    expect(setActiveOrgIdCookie).toHaveBeenCalledWith('org-personal');
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('does NOT switch when switchToOrgId is null', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const result = await leaveOrgAction('org-other', 'user-self', null);
    expect(result).toEqual({ ok: true, switchedTo: null });
    expect(setActiveOrgIdCookie).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('does NOT switch when switchTo equals leaving org (defensive)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const result = await leaveOrgAction('org-x', 'user-self', 'org-x');
    expect(result).toEqual({ ok: true, switchedTo: null });
    expect(setActiveOrgIdCookie).not.toHaveBeenCalled();
  });

  it('translates PERSONAL_ORG_UNREMOVABLE without switching', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { code: 'PERSONAL_ORG_UNREMOVABLE', message: 'no' }),
    );
    const result = await leaveOrgAction('org-personal', 'user-self', 'org-personal');
    expect(result).toMatchObject({ ok: false, code: 'PERSONAL_ORG_UNREMOVABLE' });
    expect(setActiveOrgIdCookie).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('surfaces STALE_MEMBERSHIPS without switching', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { code: 'STALE_MEMBERSHIPS' }));
    const result = await leaveOrgAction('org-other', 'user-self', 'org-personal');
    expect(result).toMatchObject({ ok: false, code: 'STALE_MEMBERSHIPS' });
    expect(setActiveOrgIdCookie).not.toHaveBeenCalled();
  });
});

describe('issueInvitationAction', () => {
  it('POSTs and revalidates on success, returning the issued invitation', async () => {
    const issued = {
      id: 'inv-1',
      email: 'bob@example.com',
      role: 'ANALYST',
      expiresAt: '2026-05-05T00:00:00.000Z',
      invitedById: 'user-self',
      status: 'PENDING',
    };
    fetchMock.mockResolvedValue(jsonResponse(201, issued));

    const result = await issueInvitationAction('org-1', 'bob@example.com', 'ANALYST');

    expect(result).toEqual({ ok: true, invitation: issued });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://api.test/org/org-1/invitations');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get('X-Org-Id')).toBe('org-1');
    expect(headers.get('Authorization')).toBe('Bearer jwt-token-value');
    expect((init as RequestInit).body).toBe(
      JSON.stringify({ email: 'bob@example.com', role: 'ANALYST' }),
    );
    expect(revalidatePath).toHaveBeenCalledWith('/settings/members');
  });

  it('translates PERSONAL_ORG_NOT_INVITABLE', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { code: 'PERSONAL_ORG_NOT_INVITABLE', message: 'no' }),
    );
    const result = await issueInvitationAction('org-personal', 'b@e.com', 'VIEWER');
    expect(result).toMatchObject({ ok: false, code: 'PERSONAL_ORG_NOT_INVITABLE' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('translates INVALID_EMAIL', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { code: 'INVALID_EMAIL', message: 'malformed' }));
    const result = await issueInvitationAction('org-1', 'bad', 'VIEWER');
    expect(result.code).toBe('INVALID_EMAIL');
  });

  it('translates OWNER_INVITE_REQUIRES_OWNER', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { code: 'OWNER_INVITE_REQUIRES_OWNER', message: 'admin cannot' }),
    );
    const result = await issueInvitationAction('org-1', 'b@e.com', 'OWNER');
    expect(result.code).toBe('OWNER_INVITE_REQUIRES_OWNER');
  });

  it('translates ALREADY_MEMBER (409)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { code: 'ALREADY_MEMBER', message: 'already a member' }),
    );
    const result = await issueInvitationAction('org-1', 'b@e.com', 'ANALYST');
    expect(result.code).toBe('ALREADY_MEMBER');
  });

  it('surfaces STALE_MEMBERSHIPS as code', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { code: 'STALE_MEMBERSHIPS' }));
    const result = await issueInvitationAction('org-1', 'b@e.com', 'ANALYST');
    expect(result.code).toBe('STALE_MEMBERSHIPS');
  });

  it('returns UNAUTHENTICATED when no session cookie', async () => {
    cookieGet.mockReturnValue(undefined);
    const result = await issueInvitationAction('org-1', 'b@e.com', 'VIEWER');
    expect(result).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('revokeInvitationAction', () => {
  it('DELETEs and revalidates on success', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const result = await revokeInvitationAction('org-1', 'inv-1');
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://api.test/org/org-1/invitations/inv-1');
    expect((init as RequestInit).method).toBe('DELETE');
    expect(revalidatePath).toHaveBeenCalledWith('/settings/members');
  });

  it('translates ALREADY_ACCEPTED (410)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(410, { code: 'ALREADY_ACCEPTED', message: 'already accepted' }),
    );
    const result = await revokeInvitationAction('org-1', 'inv-1');
    expect(result.code).toBe('ALREADY_ACCEPTED');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('translates FORBIDDEN (VIEWER trying to revoke)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { message: 'forbidden' }));
    const result = await revokeInvitationAction('org-1', 'inv-1');
    expect(result.code).toBe('FORBIDDEN');
  });

  it('falls back to NOT_FOUND when API returns 404 without code', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { message: 'not found' }));
    const result = await revokeInvitationAction('org-1', 'inv-1');
    expect(result.code).toBe('NOT_FOUND');
  });
});
