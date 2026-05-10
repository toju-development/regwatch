/**
 * Unit tests for PrismaDigestRepository.
 *
 * sdd/digest-export (POST-3) — task 7.1.
 *
 * Spec coverage:
 *  - Org alert window: only alerts where detectedAt >= since are returned
 *  - findRecentAlerts filters by organizationId + detectedAt
 *
 * Uses a Prisma mock (no real DB).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaDigestRepository } from '../digest.repository.js';
import type { PrismaClient } from '@regwatch/db/client';

function makePrismaMock() {
  return {
    alert: {
      findMany: vi.fn(),
    },
  } as unknown as PrismaClient;
}

function makeRepo(prisma: PrismaClient) {
  return new (PrismaDigestRepository as unknown as new (p: PrismaClient) => PrismaDigestRepository)(
    prisma,
  );
}

const since = new Date('2026-05-03T08:00:00.000Z');

const alertRow = {
  id: 'alert-1',
  title: 'DORA Article 5',
  status: 'NEW',
  jurisdiction: 'EU',
  detectedAt: new Date('2026-05-05T00:00:00.000Z'),
};

describe('PrismaDigestRepository', () => {
  let prisma: PrismaClient;
  let repo: PrismaDigestRepository;

  beforeEach(() => {
    prisma = makePrismaMock();
    repo = makeRepo(prisma);
  });

  it('findRecentAlerts: filters by organizationId + detectedAt >= since', async () => {
    (prisma.alert.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([alertRow]);

    const results = await repo.findRecentAlerts('org-1', since);

    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('alert-1');
    expect(results[0]!.title).toBe('DORA Article 5');
    expect(results[0]!.jurisdiction).toBe('EU');

    const call = (prisma.alert.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where).toEqual({
      organizationId: 'org-1',
      detectedAt: { gte: since },
    });
  });

  it('findRecentAlerts: returns empty array when no alerts in window', async () => {
    (prisma.alert.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const results = await repo.findRecentAlerts('org-empty', since);

    expect(results).toHaveLength(0);
  });

  it('findRecentAlerts: maps null jurisdiction correctly', async () => {
    const nullJurAlert = { ...alertRow, id: 'alert-2', jurisdiction: null };
    (prisma.alert.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([nullJurAlert]);

    const results = await repo.findRecentAlerts('org-1', since);

    expect(results[0]!.jurisdiction).toBeNull();
  });
});
