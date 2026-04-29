/**
 * Middleware public-allowlist anchor tests (B6, MVP-3b3b — D6).
 *
 * Spec: `sdd/org-invitations/spec` § R-Invitation-Preview (public) +
 *   R-Invitation-Accept (authed).
 * Design: `sdd/org-invitations/design` §0 D6 + §4 (foot-gun #9).
 *
 * Asserts the predicate `isPublicInvitationPath` correctly classifies
 * pathnames so the middleware redirect does NOT trip on the invitation
 * landing page (`/accept/<token>`) or the public preview proxy
 * (`/api/invitations/<token>`), AND DOES still redirect on the authed
 * accept proxy (`/api/invitations/<token>/accept`) for anonymous users.
 *
 * We test the predicate directly (not the full middleware) because:
 *   - The full middleware imports `readEdgeSession` which boots an
 *     edge-runtime JWT verifier — hard to stub in unit tests.
 *   - The predicate IS the contract: if it lies, the middleware does too.
 *   - Cold E2E (B8 sweep) covers end-to-end browser navigation.
 */
import { describe, expect, it } from 'vitest';

import { isPublicInvitationPath } from '../middleware.js';

describe('isPublicInvitationPath (middleware allowlist)', () => {
  describe('public paths — MUST return true', () => {
    it.each([
      // Invitation landing page: anonymous visitor must reach the preview UI.
      '/accept/abc123',
      '/accept/some-very-long-base64url-token-43chars',
      // Future-proof — any subpath under /accept/ is intentionally public.
      '/accept/abc/expired',
      // Public preview proxy.
      '/api/invitations/abc123',
      '/api/invitations/some-very-long-token',
    ])('returns true for %s', (pathname) => {
      expect(isPublicInvitationPath(pathname)).toBe(true);
    });
  });

  describe('gated paths — MUST return false (foot-gun #9 false-positive guard)', () => {
    it.each([
      // The accept proxy is authed even though it shares the /api/invitations/ prefix.
      '/api/invitations/abc/accept',
      // Empty accept-prefix segment is NOT a landing page (defends against `/accept` alone).
      '/accept',
      // Nested suffix on the preview path — the regex requires single-segment.
      '/api/invitations/abc/extra',
      // Unrelated org-scoped routes stay gated.
      '/api/org/o/invitations',
      '/api/org/o/invitations/i',
      '/dashboard',
      '/settings/members',
      // Lookalikes that should NOT bypass auth.
      '/api/invitationsx/abc',
      '/acceptx/abc',
    ])('returns false for %s', (pathname) => {
      expect(isPublicInvitationPath(pathname)).toBe(false);
    });
  });
});
