/**
 * Web-side typed errors thrown by `apiFetch` and friends.
 *
 * Spec: `sdd/org-members/spec` § R-Jwt-Invalidate-Cross-User
 *   ("Single retry only" scenario — second 401 STALE_MEMBERSHIPS surfaces
 *   to the caller as an auth error instead of a third request).
 * Design: `sdd/org-members/design` §6 (apiFetch retry loop).
 *
 * `StaleMembershipsError` is the LOUD signal that the JWT mint→retry cycle
 * has broken down — usually because `session.update({})` did not actually
 * issue a POST to `/api/auth/session` (foot-gun #670 — `{}` arg required)
 * or because the API kept rejecting with `STALE_MEMBERSHIPS` even after a
 * fresh JWT (a bug). The B6 layer catches this at the page/component edge
 * to drive sign-out + redirect; `apiFetch` itself NEVER calls `signOut()`.
 */

export class StaleMembershipsError extends Error {
  constructor(
    message = 'STALE_MEMBERSHIPS persisted after session.update({}); user must re-authenticate',
  ) {
    super(message);
    this.name = 'StaleMembershipsError';
  }
}
