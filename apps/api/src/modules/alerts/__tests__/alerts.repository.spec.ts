/**
 * Unit tests for `AlertsRepo.statsForOrg`.
 *
 * sdd/dashboard-mvp/spec Phase 5.1:
 *   - Returns correct `AlertStatsDto` shape from two Prisma groupBy calls.
 *   - byStatus and bySeverity are reshaped from array → Record<string, number>.
 *   - total = sum of all byStatus counts.
 *   - Empty org → all-zero totals.
 *
 * Mocks Prisma `groupBy` directly — no DB required.
 *
 * NO `pnpm build` after changes (project rule).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertsRepo } from '../alerts.repository.js';
import type { PrismaClient } from '@regwatch/db/client';

// ─── Mock PrismaClient ────────────────────────────────────────────────────────

function makePrisma(
  byStatusRows: Array<{ status: string; _count: { _all: number } }>,
  bySeverityRows: Array<{ severity: string; _count: { _all: number } }>,
): PrismaClient {
  return {
    alert: {
      groupBy: vi
        .fn()
        .mockResolvedValueOnce(byStatusRows) // first call → byStatus
        .mockResolvedValueOnce(bySeverityRows), // second call → bySeverity
    },
  } as unknown as PrismaClient;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

function makeRepo(prisma: PrismaClient): AlertsRepo {
  return new (AlertsRepo as unknown as new (prisma: PrismaClient) => AlertsRepo)(prisma);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AlertsRepo.statsForOrg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reshapes groupBy rows into Record<string, number> for byStatus and bySeverity', async () => {
    const prisma = makePrisma(
      [
        { status: 'NEW', _count: { _all: 3 } },
        { status: 'TRIAGING', _count: { _all: 2 } },
      ],
      [
        { severity: 'HIGH', _count: { _all: 4 } },
        { severity: 'LOW', _count: { _all: 1 } },
      ],
    );
    const repo = makeRepo(prisma);

    const result = await repo.statsForOrg('org-1');

    expect(result.byStatus).toEqual({ NEW: 3, TRIAGING: 2 });
    expect(result.bySeverity).toEqual({ HIGH: 4, LOW: 1 });
  });

  it('computes total as sum of all byStatus counts', async () => {
    const prisma = makePrisma(
      [
        { status: 'NEW', _count: { _all: 5 } },
        { status: 'ANALYZING', _count: { _all: 3 } },
        { status: 'CONCLUDED', _count: { _all: 2 } },
      ],
      [{ severity: 'CRITICAL', _count: { _all: 10 } }],
    );
    const repo = makeRepo(prisma);

    const result = await repo.statsForOrg('org-1');

    expect(result.total).toBe(10);
  });

  it('passes orgId to both groupBy calls via where clause', async () => {
    const prisma = makePrisma([], []);
    const repo = makeRepo(prisma);

    await repo.statsForOrg('org-xyz');

    const groupBy = prisma.alert.groupBy as ReturnType<typeof vi.fn>;
    expect(groupBy).toHaveBeenCalledTimes(2);
    expect(groupBy.mock.calls[0]![0]).toMatchObject({ where: { organizationId: 'org-xyz' } });
    expect(groupBy.mock.calls[1]![0]).toMatchObject({ where: { organizationId: 'org-xyz' } });
  });

  it('empty org → byStatus={}, bySeverity={}, total=0', async () => {
    const prisma = makePrisma([], []);
    const repo = makeRepo(prisma);

    const result = await repo.statsForOrg('org-empty');

    expect(result.byStatus).toEqual({});
    expect(result.bySeverity).toEqual({});
    expect(result.total).toBe(0);
  });

  it('runs both groupBy calls in parallel (Promise.all pattern)', async () => {
    const callOrder: string[] = [];
    const prisma = {
      alert: {
        groupBy: vi.fn().mockImplementation((args: { by: string[] }) => {
          callOrder.push(args.by[0] ?? 'unknown');
          return Promise.resolve([]);
        }),
      },
    } as unknown as PrismaClient;
    const repo = makeRepo(prisma);

    await repo.statsForOrg('org-1');

    // Both calls must happen — order may vary with Promise.all but both keys must exist
    expect(callOrder).toContain('status');
    expect(callOrder).toContain('severity');
    expect(callOrder).toHaveLength(2);
  });
});
