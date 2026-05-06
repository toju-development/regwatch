/**
 * Unit tests for `getMonthlyUsage` and `canScanThisMonth` (UsageHelper).
 *
 * Spec: `sdd/scanner-vertical-ar/spec` R-5, R-11, INV-SP-3, INV-UT-1.
 *       `sdd/classifier-and-writer/spec` R-Usage-3, INV-Usage-3.
 * Design: `sdd/scanner-vertical-ar/design` ADR-6.
 *         `sdd/classifier-and-writer/design` ADR-12.
 *
 * These are boundary-coverage unit tests with mocked Prisma aggregates.
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

function makePrisma(
  scanReturn: {
    _sum: { tokensUsed: number | null; costUsd: Prisma.Decimal | null };
    _count: { _all: number };
  },
  enrichmentReturn: { _sum: { costUsd: Prisma.Decimal | null } } = {
    _sum: { costUsd: null },
  },
  settingsReturn: { lastSkippedCapAt: Date | null } | null = null,
) {
  const scanAggregate = vi.fn().mockResolvedValue(scanReturn);
  const enrichmentAggregate = vi.fn().mockResolvedValue(enrichmentReturn);
  const settingsFindUnique = vi.fn().mockResolvedValue(settingsReturn);
  const prisma = {
    scanLog: { aggregate: scanAggregate },
    enrichmentLog: { aggregate: enrichmentAggregate },
    settings: { findUnique: settingsFindUnique },
  } as unknown as PrismaClient;
  return { prisma, aggregate: scanAggregate, enrichmentAggregate, settingsFindUnique };
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

  it('B5.4 R-Usage-LastSkipped: lastSkippedCapAt is returned from Settings row', async () => {
    const skipDate = new Date('2026-04-10T08:00:00.000Z');
    const { prisma } = makePrisma(
      { _sum: { tokensUsed: 0, costUsd: null }, _count: { _all: 0 } },
      { _sum: { costUsd: null } },
      { lastSkippedCapAt: skipDate },
    );

    const usage = await getMonthlyUsage(prisma, 'org-1', NOW);
    expect(usage.lastSkippedCapAt).toEqual(skipDate);
  });

  it('B5.4: lastSkippedCapAt is null when Settings row does not exist', async () => {
    const { prisma } = makePrisma(
      { _sum: { tokensUsed: 0, costUsd: null }, _count: { _all: 0 } },
      { _sum: { costUsd: null } },
      null, // no Settings row
    );

    const usage = await getMonthlyUsage(prisma, 'org-1', NOW);
    expect(usage.lastSkippedCapAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B1.5 — R-Usage-3: enrichment cost included in combined cap gate
// ---------------------------------------------------------------------------
describe('getMonthlyUsage — enrichment cost tracking (R-Usage-3, INV-Usage-3)', () => {
  it('(a) ScanLog only: enrichmentCostUsd is Decimal(0), costUsd = scanCostUsd', async () => {
    const { prisma } = makePrisma(
      { _sum: { tokensUsed: 500, costUsd: new Prisma.Decimal('3.00') }, _count: { _all: 2 } },
      { _sum: { costUsd: null } }, // no enrichment rows
    );

    const usage = await getMonthlyUsage(prisma, 'org-1', NOW);

    expect(usage.scanCostUsd).toBeInstanceOf(Prisma.Decimal);
    expect(usage.scanCostUsd.equals(new Prisma.Decimal('3.00'))).toBe(true);
    expect(usage.enrichmentCostUsd).toBeInstanceOf(Prisma.Decimal);
    expect(usage.enrichmentCostUsd.equals(0)).toBe(true);
    expect(usage.costUsd.equals(new Prisma.Decimal('3.00'))).toBe(true);
    expect(usage.isAtCap).toBe(false);
  });

  it('(b) EnrichmentLog only: scanCostUsd is Decimal(0), costUsd = enrichmentCostUsd', async () => {
    const { prisma } = makePrisma(
      { _sum: { tokensUsed: null, costUsd: null }, _count: { _all: 0 } },
      { _sum: { costUsd: new Prisma.Decimal('2.50') } },
    );

    const usage = await getMonthlyUsage(prisma, 'org-1', NOW);

    expect(usage.scanCostUsd).toBeInstanceOf(Prisma.Decimal);
    expect(usage.scanCostUsd.equals(0)).toBe(true);
    expect(usage.enrichmentCostUsd).toBeInstanceOf(Prisma.Decimal);
    expect(usage.enrichmentCostUsd.equals(new Prisma.Decimal('2.50'))).toBe(true);
    expect(usage.costUsd.equals(new Prisma.Decimal('2.50'))).toBe(true);
  });

  it('(c) Both: costUsd = scanCostUsd + enrichmentCostUsd (no double-counting, INV-Usage-3)', async () => {
    const { prisma } = makePrisma(
      { _sum: { tokensUsed: 1000, costUsd: new Prisma.Decimal('4.00') }, _count: { _all: 5 } },
      { _sum: { costUsd: new Prisma.Decimal('7.00') } },
    );

    const usage = await getMonthlyUsage(prisma, 'org-1', NOW);

    expect(usage.scanCostUsd.equals(new Prisma.Decimal('4.00'))).toBe(true);
    expect(usage.enrichmentCostUsd.equals(new Prisma.Decimal('7.00'))).toBe(true);
    // Combined = $11 → over the $10 cap
    expect(usage.costUsd.equals(new Prisma.Decimal('11.00'))).toBe(true);
    expect(usage.isAtCap).toBe(true);
    expect(usage.percent).toBe(110);
  });

  it('(d) Neither: all Decimal fields are Decimal(0), isAtCap = false', async () => {
    const { prisma } = makePrisma(
      { _sum: { tokensUsed: null, costUsd: null }, _count: { _all: 0 } },
      { _sum: { costUsd: null } },
    );

    const usage = await getMonthlyUsage(prisma, 'org-1', NOW);

    expect(usage.scanCostUsd).toBeInstanceOf(Prisma.Decimal);
    expect(usage.enrichmentCostUsd).toBeInstanceOf(Prisma.Decimal);
    expect(usage.costUsd).toBeInstanceOf(Prisma.Decimal);
    expect(usage.scanCostUsd.equals(0)).toBe(true);
    expect(usage.enrichmentCostUsd.equals(0)).toBe(true);
    expect(usage.costUsd.equals(0)).toBe(true);
    expect(usage.isAtCap).toBe(false);
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
