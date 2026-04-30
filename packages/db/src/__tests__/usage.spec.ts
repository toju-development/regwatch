/**
 * Unit tests for `getMonthlyUsage` and `canScanThisMonth` (UsageHelper).
 *
 * Spec: `sdd/scanner-vertical-ar/spec` R-5, R-11, INV-SP-3, INV-UT-1.
 * Design: `sdd/scanner-vertical-ar/design` ADR-6.
 *
 * These are boundary-coverage unit tests with a mocked `prisma.scanLog.aggregate`.
 * Real-Postgres integration coverage is provided indirectly by:
 *   - `apps/scanner/src/modules/scan/scan.service.spec.ts` (cap gate behavior)
 *   - the migration applied to the local Postgres (schema shape)
 * A future MVP can add a true integration test under `packages/db/integration/`
 * once the testcontainers wiring is set up — tracked in apply-progress risks.
 */
import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../generated/client/index.js';
import {
  canScanThisMonth,
  getMonthlyUsage,
  MONTHLY_CAP_DECIMAL,
  startOfMonthUtc,
} from '../usage.js';

function makePrisma(aggReturn: {
  _sum: { tokensUsed: number | null; costUsd: Prisma.Decimal | null };
  _count: { _all: number };
}) {
  const aggregate = vi.fn().mockResolvedValue(aggReturn);
  const prisma = { scanLog: { aggregate } } as unknown as PrismaClient;
  return { prisma, aggregate };
}

const NOW = new Date('2026-04-15T12:34:56Z');
const EXPECTED_MONTH_START = new Date('2026-04-01T00:00:00Z');

describe('startOfMonthUtc', () => {
  it('returns the first instant of the UTC month', () => {
    expect(startOfMonthUtc(NOW).toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('floors the last instant of December to the start of December (not January)', () => {
    // 2026-12-31T23:59:59Z is still inside December → start-of-month is Dec 1,
    // NOT Jan 1. This guards against a year-rollover off-by-one in
    // `startOfMonthUtc` (e.g. accidentally adding 1 to the month).
    expect(startOfMonthUtc(new Date('2026-12-31T23:59:59Z')).toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );
  });

  it('handles the first instant of January (year-boundary identity)', () => {
    // The actual December → January rollover: Jan 1 00:00:00 must map to
    // itself (the first instant of the new month/year). This is the
    // boundary that the previous test name CLAIMED to cover but did not.
    expect(startOfMonthUtc(new Date('2027-01-01T00:00:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });

  it('floors mid-January back to Jan 1 (does NOT leak into the previous year)', () => {
    // Belt-and-suspenders for year boundary: a date in mid-January must
    // floor to Jan 1 of the SAME year, never to Dec 1 of the previous year.
    expect(startOfMonthUtc(new Date('2027-01-15T08:30:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
});

describe('getMonthlyUsage', () => {
  it('returns zeroed usage when the org has no scans this month', async () => {
    const { prisma, aggregate } = makePrisma({
      _sum: { tokensUsed: null, costUsd: null },
      _count: { _all: 0 },
    });

    const usage = await getMonthlyUsage(prisma, 'org-1', NOW);

    expect(usage.tokensUsed).toBe(0);
    expect(usage.costUsd).toBeInstanceOf(Prisma.Decimal);
    expect(usage.costUsd.equals(0)).toBe(true);
    expect(usage.scansCount).toBe(0);
    expect(usage.capUsd.equals(MONTHLY_CAP_DECIMAL)).toBe(true);
    expect(usage.isAtCap).toBe(false);
    expect(usage.percent).toBe(0);
    expect(usage.monthStart.toISOString()).toBe(EXPECTED_MONTH_START.toISOString());

    // Aggregation filter MUST scope by org AND by month start.
    const args = aggregate.mock.calls[0]?.[0];
    expect(args.where.organizationId).toBe('org-1');
    expect(args.where.startedAt.gte.toISOString()).toBe(EXPECTED_MONTH_START.toISOString());
    expect(args._sum).toEqual({ tokensUsed: true, costUsd: true });
  });

  it('aggregates tokens + cost under cap (just-under boundary)', async () => {
    const { prisma } = makePrisma({
      _sum: { tokensUsed: 12_345, costUsd: new Prisma.Decimal('9.999999') },
      _count: { _all: 7 },
    });

    const usage = await getMonthlyUsage(prisma, 'org-1', NOW);

    expect(usage.tokensUsed).toBe(12_345);
    expect(usage.costUsd.toString()).toBe('9.999999');
    expect(usage.scansCount).toBe(7);
    expect(usage.isAtCap).toBe(false);
    expect(usage.percent).toBe(99); // floor(9.999999 * 100 / 10) = 99
  });

  it('R-5 boundary: exactly at cap ($10.000000) → isAtCap = true', async () => {
    const { prisma } = makePrisma({
      _sum: { tokensUsed: 1_000_000, costUsd: new Prisma.Decimal('10.000000') },
      _count: { _all: 42 },
    });

    const usage = await getMonthlyUsage(prisma, 'org-1', NOW);

    expect(usage.isAtCap).toBe(true);
    expect(usage.percent).toBe(100);
  });

  it('over cap ($10.000001) → isAtCap = true with percent ≥ 100', async () => {
    const { prisma } = makePrisma({
      _sum: { tokensUsed: 999_999, costUsd: new Prisma.Decimal('10.000001') },
      _count: { _all: 50 },
    });

    const usage = await getMonthlyUsage(prisma, 'org-1', NOW);

    expect(usage.isAtCap).toBe(true);
    expect(usage.percent).toBe(100); // floor(10.000001 * 100 / 10) = 100
  });

  it('INV-SP-3: costUsd is always Prisma.Decimal even on null aggregate', async () => {
    const { prisma } = makePrisma({
      _sum: { tokensUsed: null, costUsd: null },
      _count: { _all: 0 },
    });

    const usage = await getMonthlyUsage(prisma, 'org-1', NOW);
    expect(usage.costUsd).toBeInstanceOf(Prisma.Decimal);
    // capUsd MUST also be a Decimal (not a JS number).
    expect(usage.capUsd).toBeInstanceOf(Prisma.Decimal);
  });

  it('uses Date.now() default when `now` is omitted', async () => {
    const { prisma, aggregate } = makePrisma({
      _sum: { tokensUsed: 0, costUsd: new Prisma.Decimal('0') },
      _count: { _all: 0 },
    });

    await getMonthlyUsage(prisma, 'org-1');

    const args = aggregate.mock.calls[0]?.[0];
    // The default `now` lands inside the current month — gte boundary should
    // be the first of THIS month at 00:00:00 UTC.
    const expected = startOfMonthUtc(new Date());
    expect((args.where.startedAt.gte as Date).toISOString()).toBe(expected.toISOString());
  });
});

describe('canScanThisMonth (R-11 thin wrapper)', () => {
  it('returns allowed=true when usage is under cap', async () => {
    const { prisma } = makePrisma({
      _sum: { tokensUsed: 1000, costUsd: new Prisma.Decimal('5.5') },
      _count: { _all: 3 },
    });

    const result = await canScanThisMonth(prisma, 'org-1', NOW);

    expect(result.allowed).toBe(true);
    expect(result.currentUsd.toString()).toBe('5.5');
    expect(result.capUsd.equals(MONTHLY_CAP_DECIMAL)).toBe(true);
    expect(result.percent).toBe(55);
  });

  it('returns allowed=false at exactly the cap (R-5 boundary)', async () => {
    const { prisma } = makePrisma({
      _sum: { tokensUsed: 1_000_000, costUsd: new Prisma.Decimal('10') },
      _count: { _all: 50 },
    });

    const result = await canScanThisMonth(prisma, 'org-1', NOW);
    expect(result.allowed).toBe(false);
    expect(result.percent).toBe(100);
  });
});
