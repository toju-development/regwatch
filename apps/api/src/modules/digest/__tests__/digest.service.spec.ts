/**
 * Unit tests for DigestService.
 *
 * sdd/digest-export (POST-3) — task 7.2.
 *
 * Spec coverage:
 *  - skip-empty: org with 0 alerts → EMAIL_PORT.send never called
 *  - send-to-owners: only OWNER members receive email (not ADMIN/ANALYST)
 *  - grouping: null jurisdiction → "Unclassified"; multiple alerts per jurisdiction grouped
 *  - no-owners: alerts present but 0 OWNER members → no send
 */

import { describe, it, expect, vi } from 'vitest';
import { DigestService } from '../digest.service.js';
import type { DigestRepository } from '../digest.repository.js';
import type { MembersRepo } from '../../members/members.repo.js';
import type { EmailPort } from '../../email/email.port.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAlert(
  overrides: Partial<{
    id: string;
    title: string;
    status: string;
    jurisdiction: string | null;
    detectedAt: Date;
  }> = {},
) {
  return {
    id: 'alert-1',
    title: 'Test Alert',
    status: 'NEW',
    jurisdiction: 'EU',
    detectedAt: new Date('2026-05-05T00:00:00.000Z'),
    ...overrides,
  };
}

function makeMember(role: string, email = 'owner@example.com') {
  return {
    userId: 'user-1',
    email,
    name: 'Alice',
    role: role as 'OWNER' | 'ADMIN' | 'ANALYST' | 'VIEWER',
    joinedAt: new Date(),
    isPersonalOrgOwner: false,
  };
}

function makeService(opts: {
  alerts?: ReturnType<typeof makeAlert>[];
  members?: ReturnType<typeof makeMember>[];
}) {
  const digestRepo: DigestRepository = {
    findRecentAlerts: vi.fn().mockResolvedValue(opts.alerts ?? []),
  };
  const membersRepo: MembersRepo = {
    listByOrg: vi.fn().mockResolvedValue(opts.members ?? []),
    // other methods unused by DigestService
    getUserMembershipsVersion: vi.fn(),
    findInOrg: vi.fn(),
    findUserPersonalOrgId: vi.fn(),
    countOwners: vi.fn(),
    updateMembershipRole: vi.fn(),
    deleteMembership: vi.fn(),
    findFullInOrg: vi.fn(),
    createMembership: vi.fn(),
    bumpUserVersion: vi.fn(),
  };
  const emailPort: EmailPort = {
    send: vi.fn().mockResolvedValue(undefined),
  };

  const service = new (DigestService as unknown as new (
    repo: DigestRepository,
    members: MembersRepo,
    email: EmailPort,
  ) => DigestService)(digestRepo, membersRepo, emailPort);

  return { service, digestRepo, membersRepo, emailPort };
}

const windowStart = new Date('2026-05-03T08:00:00.000Z');
const windowEnd = new Date('2026-05-10T08:00:00.000Z');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DigestService', () => {
  describe('skip-empty: 0 alerts in window', () => {
    it('does not call EMAIL_PORT.send when org has 0 alerts', async () => {
      const { service, emailPort } = makeService({
        alerts: [],
        members: [makeMember('OWNER')],
      });

      await service.buildAndSend('org-1', 'Acme', windowStart, windowEnd);

      expect(emailPort.send).not.toHaveBeenCalled();
    });
  });

  describe('no-owners: alerts present but 0 OWNER members', () => {
    it('does not send when there are no OWNER members', async () => {
      const { service, emailPort } = makeService({
        alerts: [makeAlert()],
        members: [makeMember('ADMIN'), makeMember('ANALYST', 'analyst@example.com')],
      });

      await service.buildAndSend('org-1', 'Beta', windowStart, windowEnd);

      expect(emailPort.send).not.toHaveBeenCalled();
    });
  });

  describe('send-to-owners: OWNER-only recipients', () => {
    it('sends only to OWNER members, not ADMIN or ANALYST', async () => {
      const { service, emailPort } = makeService({
        alerts: [makeAlert()],
        members: [
          makeMember('OWNER', 'alice@example.com'),
          makeMember('ADMIN', 'bob@example.com'),
          makeMember('ANALYST', 'carol@example.com'),
        ],
      });

      await service.buildAndSend('org-1', 'Gamma', windowStart, windowEnd);

      expect(emailPort.send).toHaveBeenCalledTimes(1);
      const call = (emailPort.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(call.to).toBe('alice@example.com');
    });

    it('subject matches "RegWatch weekly digest — {orgName}"', async () => {
      const { service, emailPort } = makeService({
        alerts: [makeAlert()],
        members: [makeMember('OWNER')],
      });

      await service.buildAndSend('org-1', 'TojuCo', windowStart, windowEnd);

      const call = (emailPort.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(call.subject).toBe('RegWatch weekly digest — TojuCo');
    });
  });

  describe('grouping: alerts grouped by jurisdiction', () => {
    it('groups alerts under correct jurisdiction headers, null → "Unclassified"', async () => {
      const { service, emailPort } = makeService({
        alerts: [
          makeAlert({ id: 'a1', jurisdiction: 'EU' }),
          makeAlert({ id: 'a2', jurisdiction: null }),
          makeAlert({ id: 'a3', jurisdiction: 'EU' }),
        ],
        members: [makeMember('OWNER')],
      });

      await service.buildAndSend('org-1', 'Delta', windowStart, windowEnd);

      expect(emailPort.send).toHaveBeenCalledTimes(1);
      const call = (emailPort.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      // HTML should contain both "EU" group header and "Unclassified"
      expect(call.html).toContain('EU');
      expect(call.html).toContain('Unclassified');
    });
  });
});
