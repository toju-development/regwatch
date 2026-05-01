/**
 * Unit tests for `ScanService.runScan`.
 *
 * Validates the R-3 chokepoint contract AND B4 additions:
 *   - the trusted `orgId` parameter (never agent output) is the org stamped on
 *     persisted Alert rows,
 *   - dedup is applied BEFORE the DB write,
 *   - persistence happens inside `prisma.$transaction`,
 *   - `scan.completed` is emitted POST-commit (never inside the tx),
 *   - a throwing listener does NOT bubble out and break the caller,
 *   - an agent throw produces a `FAILED` ScanLog row + emitted event with
 *     `errorMsg`, no Alerts written.
 *   - B4: monthly cap gate (R-5) → SKIPPED_CAP_EXCEEDED ScanLog, no LLM call,
 *     no $transaction (single-row create only), event still emitted.
 *   - B4: real `costUsd` + `tokensUsed` from cost helper (R-6, INV-SP-3).
 *   - B4: per-org mutex (ADR-6) → concurrent runScan dedups to ONE LLM call.
 *
 * Spec: sdd/scanner-vertical-ar/spec R-3, R-4, R-5, R-6, R-9, R-10.
 * Design: sdd/scanner-vertical-ar/design ADR-2, ADR-5, ADR-6, ADR-9, ADR-14, ADR-15.
 */
import 'reflect-metadata';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, type PrismaClient } from '@regwatch/db/client';
import { SCAN_COMPLETED_EVENT } from '@regwatch/types/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScanService, type CostHelper, type UsageHelper } from './scan.service.js';
import type { RootAgent } from './agents/root.agent.js';
import { dedupFindings } from './utils/dedup.helper.js';
import { computeCostFromUsageMetadata } from './utils/cost.helper.js';

interface FakeTx {
  scanLog: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  alert: { createMany: ReturnType<typeof vi.fn> };
}

interface MakeFakesOpts {
  /** Override usage returned by `getMonthlyUsage`. Default: zero/under-cap. */
  usageReturn?: Partial<{
    tokensUsed: number;
    costUsd: Prisma.Decimal;
    scansCount: number;
    capUsd: Prisma.Decimal;
    isAtCap: boolean;
    percent: number;
    monthStart: Date;
  }>;
}

function makeFakes(opts: MakeFakesOpts = {}) {
  const scanLogCreate = vi.fn();
  const scanLogUpdate = vi.fn();
  const alertCreateMany = vi.fn();
  const tx: FakeTx = {
    scanLog: { create: scanLogCreate, update: scanLogUpdate },
    alert: { createMany: alertCreateMany },
  };
  const $transaction = vi.fn(async (cb: (tx: FakeTx) => unknown) => cb(tx));
  // Top-level `prisma.scanLog.create` is used by the SKIPPED_CAP_EXCEEDED path.
  const topLevelScanLogCreate = vi.fn();
  const prisma = {
    $transaction,
    scanLog: { create: topLevelScanLogCreate },
  } as unknown as PrismaClient;

  const defaultUsage = {
    tokensUsed: 0,
    costUsd: new Prisma.Decimal(0),
    scansCount: 0,
    capUsd: new Prisma.Decimal(10),
    isAtCap: false,
    percent: 0,
    monthStart: new Date('2026-04-01T00:00:00Z'),
  };
  const usage: UsageHelper = {
    getMonthlyUsage: vi.fn().mockResolvedValue({ ...defaultUsage, ...opts.usageReturn }),
  };

  return {
    prisma,
    $transaction,
    scanLogCreate, // tx-scoped
    scanLogUpdate,
    alertCreateMany,
    topLevelScanLogCreate, // SKIPPED path
    usage,
  };
}

function makeService(
  rootAgent: RootAgent,
  prisma: PrismaClient,
  usage: UsageHelper,
  emit: ReturnType<typeof vi.fn> = vi.fn(),
  costOverride?: CostHelper,
) {
  const ev = { emit } as unknown as EventEmitter2;
  const cost: CostHelper = costOverride ?? { computeCostFromUsageMetadata };
  return {
    svc: new ScanService(rootAgent, { dedupFindings }, ev, prisma, usage, cost),
    emit,
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('ScanService.runScan (R-3 chokepoint)', () => {
  it('persists alerts under the TRUSTED orgId, ignoring any LLM-injected org id', async () => {
    const rootAgent: RootAgent = {
      run: vi.fn().mockResolvedValue({
        jurisdiction: 'AR',
        findings: [
          {
            source: 'BCRA_COMUNICADOS_A',
            sourceUrl: 'https://www.bcra.gob.ar/foo',
            title: 'A 1234',
            summary: 'body',
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 },
      }),
    };
    const fakes = makeFakes();
    fakes.scanLogCreate.mockResolvedValue({
      id: 'scanlog-1',
      completedAt: new Date('2026-04-30T01:00:00Z'),
    });
    fakes.alertCreateMany.mockResolvedValue({ count: 1 });

    const { svc, emit } = makeService(rootAgent, fakes.prisma, fakes.usage);
    const result = await svc.runScan('TRUSTED-ORG-ID', 'AR');

    expect(result.scanLogId).toBe('scanlog-1');
    expect(result.status).toBe('COMPLETED');
    expect(result.alertsFound).toBe(1);
    // 5 prompt + 7 candidate = 12 tokens
    expect(result.tokensUsed).toBe(12);

    const alertCall = fakes.alertCreateMany.mock.calls[0]?.[0];
    expect(alertCall.skipDuplicates).toBe(true);
    expect(alertCall.data[0].organizationId).toBe('TRUSTED-ORG-ID');
    expect(alertCall.data[0].sourceUrlHash).toMatch(/^[a-f0-9]{64}$/);
    expect(alertCall.data[0].scanLogId).toBe('scanlog-1');

    expect(fakes.scanLogCreate.mock.calls[0]?.[0].data.organizationId).toBe('TRUSTED-ORG-ID');

    expect(fakes.$transaction).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith(
      SCAN_COMPLETED_EVENT,
      expect.objectContaining({
        scanLogId: 'scanlog-1',
        organizationId: 'TRUSTED-ORG-ID',
        jurisdiction: 'AR',
        status: 'COMPLETED',
        alertsFound: 1,
        tokensUsed: 12,
        // 5 * 0.30/1e6 + 7 * 2.50/1e6 = 0.0000015 + 0.0000175 = 0.0000190
        costUsd: '0.000019',
        errorMsg: null,
      }),
    );
  });

  it('runs dedup BEFORE the DB write (duplicate URLs collapse)', async () => {
    const rootAgent: RootAgent = {
      run: vi.fn().mockResolvedValue({
        jurisdiction: 'AR',
        findings: [
          {
            source: 'BCRA_COMUNICADOS_A',
            sourceUrl: 'https://www.bcra.gob.ar/x',
            title: 't',
            summary: 's',
          },
          {
            source: 'BCRA_COMUNICADOS_A',
            sourceUrl: 'https://WWW.BCRA.GOB.AR/x/',
            title: 't',
            summary: 's',
          },
          {
            source: 'BCRA_COMUNICADOS_A',
            sourceUrl: 'https://www.bcra.gob.ar/y',
            title: 't',
            summary: 's',
          },
        ],
        usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
      }),
    };
    const fakes = makeFakes();
    fakes.scanLogCreate.mockResolvedValue({ id: 'sl', completedAt: new Date() });
    fakes.alertCreateMany.mockResolvedValue({ count: 2 });

    const { svc } = makeService(rootAgent, fakes.prisma, fakes.usage);
    await svc.runScan('org-1');

    const alertCall = fakes.alertCreateMany.mock.calls[0]?.[0];
    expect(alertCall.data).toHaveLength(2);
  });

  it('emits FAILED event with errorMsg when the agent throws (no Alerts written)', async () => {
    const rootAgent: RootAgent = {
      run: vi.fn().mockRejectedValue(new Error('Gemini rate-limit 429')),
    };
    const fakes = makeFakes();
    fakes.scanLogCreate.mockResolvedValue({
      id: 'sl-err',
      completedAt: new Date('2026-04-30T01:00:00Z'),
    });

    const { svc, emit } = makeService(rootAgent, fakes.prisma, fakes.usage);
    const result = await svc.runScan('org-2');

    expect(result.status).toBe('FAILED');
    expect(result.errorMsg).toBe('Gemini rate-limit 429');
    expect(result.alertsFound).toBe(0);
    expect(fakes.alertCreateMany).not.toHaveBeenCalled();
    expect(fakes.scanLogCreate.mock.calls[0]?.[0].data.status).toBe('FAILED');
    expect(emit).toHaveBeenCalledWith(
      SCAN_COMPLETED_EVENT,
      expect.objectContaining({
        status: 'FAILED',
        errorMsg: 'Gemini rate-limit 429',
        alertsFound: 0,
      }),
    );
  });

  it('does not let a throwing listener bubble out (D13 mirror)', async () => {
    const rootAgent: RootAgent = {
      run: vi.fn().mockResolvedValue({
        jurisdiction: 'AR',
        findings: [],
        usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
      }),
    };
    const fakes = makeFakes();
    fakes.scanLogCreate.mockResolvedValue({ id: 'sl-emit', completedAt: new Date() });

    const emit = vi.fn().mockImplementation(() => {
      throw new Error('listener exploded');
    });
    const { svc } = makeService(rootAgent, fakes.prisma, fakes.usage, emit);

    await expect(svc.runScan('org-3')).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(emit).toHaveBeenCalled();
  });

  it('does NOT emit if the $transaction itself throws (no commit, no event)', async () => {
    const rootAgent: RootAgent = {
      run: vi.fn().mockResolvedValue({
        jurisdiction: 'AR',
        findings: [],
        usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
      }),
    };
    const fakes = makeFakes();
    fakes.$transaction.mockRejectedValueOnce(new Error('db down'));
    const { svc, emit } = makeService(rootAgent, fakes.prisma, fakes.usage);

    await expect(svc.runScan('org-4')).rejects.toThrow('db down');
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('ScanService.runScan — B4 cap gate (R-5)', () => {
  it('skips the LLM call entirely when isAtCap=true and persists SKIPPED_CAP_EXCEEDED', async () => {
    const rootAgent: RootAgent = { run: vi.fn() };
    const fakes = makeFakes({
      usageReturn: {
        costUsd: new Prisma.Decimal('10.000000'),
        capUsd: new Prisma.Decimal('10'),
        isAtCap: true,
        percent: 100,
      },
    });
    fakes.topLevelScanLogCreate.mockResolvedValue({
      id: 'sl-skip',
      completedAt: new Date('2026-04-30T02:00:00Z'),
    });

    const { svc, emit } = makeService(rootAgent, fakes.prisma, fakes.usage);
    const result = await svc.runScan('org-at-cap');

    // RootAgent never called.
    expect(rootAgent.run).not.toHaveBeenCalled();
    // No $transaction either — single-row create on the SKIP path.
    expect(fakes.$transaction).not.toHaveBeenCalled();

    expect(fakes.topLevelScanLogCreate).toHaveBeenCalledOnce();
    const writeArgs = fakes.topLevelScanLogCreate.mock.calls[0]?.[0];
    expect(writeArgs.data.status).toBe('SKIPPED_CAP_EXCEEDED');
    expect(writeArgs.data.organizationId).toBe('org-at-cap');
    expect(writeArgs.data.tokensUsed).toBe(0);
    expect((writeArgs.data.costUsd as Prisma.Decimal).equals(0)).toBe(true);
    expect(writeArgs.data.errorMsg).toContain('monthly cap reached');

    expect(result.status).toBe('SKIPPED_CAP_EXCEEDED');
    expect(result.tokensUsed).toBe(0);
    expect(result.costUsd).toBe('0');

    expect(emit).toHaveBeenCalledWith(
      SCAN_COMPLETED_EVENT,
      expect.objectContaining({
        scanLogId: 'sl-skip',
        organizationId: 'org-at-cap',
        status: 'SKIPPED_CAP_EXCEEDED',
        tokensUsed: 0,
        costUsd: '0',
      }),
    );
  });
});

describe('ScanService.runScan — B4 cost tracking (R-6, INV-SP-3)', () => {
  it('persists real costUsd from usageMetadata (50K in + 5K out → 0.0275)', async () => {
    const rootAgent: RootAgent = {
      run: vi.fn().mockResolvedValue({
        jurisdiction: 'AR',
        findings: [],
        usageMetadata: {
          promptTokenCount: 50_000,
          candidatesTokenCount: 5_000,
          totalTokenCount: 55_000,
        },
      }),
    };
    const fakes = makeFakes();
    fakes.scanLogCreate.mockResolvedValue({
      id: 'sl-cost',
      completedAt: new Date('2026-04-30T03:00:00Z'),
    });

    const { svc, emit } = makeService(rootAgent, fakes.prisma, fakes.usage);
    const result = await svc.runScan('org-cost');

    const writeArgs = fakes.scanLogCreate.mock.calls[0]?.[0];
    expect(writeArgs.data.tokensUsed).toBe(55_000);
    // INV-SP-3: persisted as Decimal, never JS number.
    expect(writeArgs.data.costUsd).toBeInstanceOf(Prisma.Decimal);
    expect((writeArgs.data.costUsd as Prisma.Decimal).toString()).toBe('0.0275');

    expect(result.tokensUsed).toBe(55_000);
    expect(result.costUsd).toBe('0.0275');

    expect(emit).toHaveBeenCalledWith(
      SCAN_COMPLETED_EVENT,
      expect.objectContaining({ tokensUsed: 55_000, costUsd: '0.0275' }),
    );
  });
});

describe('ScanService.runScan — B4 per-org mutex (ADR-6 dedup)', () => {
  it('dedups concurrent runScan(sameOrg): exactly ONE LLM call, all callers resolve', async () => {
    // Gate the agent on a manual deferred so we can assert ordering.
    let resolveAgent!: (v: unknown) => void;
    const agentDeferred = new Promise<unknown>((r) => {
      resolveAgent = r;
    });
    const runMock = vi.fn().mockReturnValue(agentDeferred);
    const rootAgent: RootAgent = { run: runMock };

    const fakes = makeFakes();
    fakes.scanLogCreate.mockResolvedValue({ id: 'sl-mutex', completedAt: new Date() });
    fakes.alertCreateMany.mockResolvedValue({ count: 0 });

    const { svc } = makeService(rootAgent, fakes.prisma, fakes.usage);

    // Fire 3 concurrent runScan calls for the SAME org.
    const p1 = svc.runScan('org-mutex');
    const p2 = svc.runScan('org-mutex');
    const p3 = svc.runScan('org-mutex');

    // Let microtasks flush so all three calls land in the mutex map.
    await Promise.resolve();
    expect(runMock).toHaveBeenCalledTimes(1);

    // Resolve the agent — all 3 promises should now settle.
    resolveAgent({
      jurisdiction: 'AR',
      findings: [],
      usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
    });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    // All callers see the SAME result (return-existing-promise dedup).
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it('releases the mutex after completion so subsequent scans run normally', async () => {
    const rootAgent: RootAgent = {
      run: vi.fn().mockResolvedValue({
        jurisdiction: 'AR',
        findings: [],
        usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
      }),
    };
    const fakes = makeFakes();
    fakes.scanLogCreate.mockResolvedValue({ id: 'sl-rel', completedAt: new Date() });
    fakes.alertCreateMany.mockResolvedValue({ count: 0 });

    const { svc } = makeService(rootAgent, fakes.prisma, fakes.usage);

    await svc.runScan('org-rel');
    await svc.runScan('org-rel');

    // Two sequential calls → two distinct LLM invocations (mutex was released).
    expect(rootAgent.run).toHaveBeenCalledTimes(2);
  });

  it('releases the mutex even when the inner scan throws', async () => {
    const rootAgent: RootAgent = { run: vi.fn() };
    const fakes = makeFakes();
    // First call: $transaction blows up so runScanInner rejects.
    fakes.$transaction
      .mockRejectedValueOnce(new Error('db boom'))
      .mockImplementationOnce(async (cb: (tx: FakeTx) => unknown) => {
        const tx: FakeTx = {
          scanLog: { create: fakes.scanLogCreate, update: fakes.scanLogUpdate },
          alert: { createMany: fakes.alertCreateMany },
        };
        return cb(tx);
      });
    fakes.scanLogCreate.mockResolvedValue({ id: 'sl-after', completedAt: new Date() });
    fakes.alertCreateMany.mockResolvedValue({ count: 0 });
    (rootAgent.run as ReturnType<typeof vi.fn>).mockResolvedValue({
      jurisdiction: 'AR',
      findings: [],
      usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
    });

    const { svc } = makeService(rootAgent, fakes.prisma, fakes.usage);

    await expect(svc.runScan('org-throw')).rejects.toThrow('db boom');
    // Second call must NOT see the rejected promise (mutex must have been freed).
    await expect(svc.runScan('org-throw')).resolves.toMatchObject({ status: 'COMPLETED' });
  });
});
