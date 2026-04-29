import { describe, expect, it } from 'vitest';
import { computeInvitationStatus } from '../invitations.js';

/**
 * Truth-table coverage for computeInvitationStatus — sdd/org-invitations
 * R-Invitation-Status-Computed (2 spec scenarios) + 4-corner edges per D8.
 *
 * Precedence: REVOKED > ACCEPTED > EXPIRED > PENDING.
 */

const T0 = new Date('2026-04-01T00:00:00Z'); // past
const NOW = new Date('2026-05-01T00:00:00Z');
const T1 = new Date('2026-06-01T00:00:00Z'); // future

describe('computeInvitationStatus', () => {
  it('precedence: REVOKED beats EXPIRED (spec scenario)', () => {
    const status = computeInvitationStatus({ revokedAt: T0, acceptedAt: null, expiresAt: T0 }, NOW);
    expect(status).toBe('REVOKED');
  });

  it('precedence: REVOKED beats ACCEPTED (explicit > terminal)', () => {
    // Edge: a row that was accepted then revoked. The spec phrases revoke of
    // ACCEPTED as a 410 ALREADY_ACCEPTED at the API boundary, but the helper
    // itself MUST be deterministic and return REVOKED if the column is set.
    const status = computeInvitationStatus({ revokedAt: T0, acceptedAt: T0, expiresAt: T1 }, NOW);
    expect(status).toBe('REVOKED');
  });

  it('precedence: ACCEPTED beats EXPIRED (spec scenario)', () => {
    const status = computeInvitationStatus({ revokedAt: null, acceptedAt: T0, expiresAt: T0 }, NOW);
    expect(status).toBe('ACCEPTED');
  });

  it('returns EXPIRED when only expiresAt is in the past', () => {
    const status = computeInvitationStatus(
      { revokedAt: null, acceptedAt: null, expiresAt: T0 },
      NOW,
    );
    expect(status).toBe('EXPIRED');
  });

  it('returns PENDING when expiresAt is in the future and no terminal flags', () => {
    const status = computeInvitationStatus(
      { revokedAt: null, acceptedAt: null, expiresAt: T1 },
      NOW,
    );
    expect(status).toBe('PENDING');
  });

  it('boundary: expiresAt === now is still PENDING (strict < comparison)', () => {
    // One tick of grace — matches spec language "now > expiresAt".
    const status = computeInvitationStatus(
      { revokedAt: null, acceptedAt: null, expiresAt: NOW },
      NOW,
    );
    expect(status).toBe('PENDING');
  });

  it('defaults `now` to wall-clock when omitted', () => {
    const farFuture = new Date(Date.now() + 86_400_000); // +24h
    expect(
      computeInvitationStatus({
        revokedAt: null,
        acceptedAt: null,
        expiresAt: farFuture,
      }),
    ).toBe('PENDING');
  });
});
