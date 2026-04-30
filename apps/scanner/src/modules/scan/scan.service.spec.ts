/**
 * Unit tests for `ScanService.runScan`.
 *
 * Validates the R-3 chokepoint contract:
 *   - the trusted `orgId` parameter (never agent output) is the org stamped on
 *     persisted Alert rows,
 *   - dedup is applied BEFORE the DB write,
 *   - persistence happens inside `prisma.$transaction`,
 *   - `scan.completed` is emitted POST-commit (never inside the tx),
 *   - a throwing listener does NOT bubble out and break the caller,
 *   - an agent throw produces a `FAILED` ScanLog row + emitted event with
 *     `errorMsg`, no Alerts written.
 *
 * Spec: sdd/scanner-vertical-ar/spec R-3, R-4, R-9, R-10.
 * Design: sdd/scanner-vertical-ar/design ADR-2, ADR-9, ADR-14, ADR-15.
 */
import 'reflect-metadata';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaClient } from '@regwatch/db/client';
import { SCAN_COMPLETED_EVENT } from '@regwatch/types/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScanService } from './scan.service.js';
import type { RootAgent } from './agents/root.agent.js';
import { dedupFindings } from './utils/dedup.helper.js';

interface FakeTx {
  scanLog: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  alert: { createMany: ReturnType<typeof vi.fn> };
}

function makeFakes() {
  const scanLogCreate = vi.fn();
  const scanLogUpdate = vi.fn();
  const alertCreateMany = vi.fn();
  const tx: FakeTx = {
    scanLog: { create: scanLogCreate, update: scanLogUpdate },
    alert: { createMany: alertCreateMany },
  };
  const $transaction = vi.fn(async (cb: (tx: FakeTx) => unknown) => cb(tx));
  const prisma = { $transaction } as unknown as PrismaClient;
  return { prisma, $transaction, scanLogCreate, scanLogUpdate, alertCreateMany };
}

function makeService(
  rootAgent: RootAgent,
  prisma: PrismaClient,
  emit: ReturnType<typeof vi.fn> = vi.fn(),
) {
  const ev = { emit } as unknown as EventEmitter2;
  return { svc: new ScanService(rootAgent, { dedupFindings }, ev, prisma), emit };
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

    const { svc, emit } = makeService(rootAgent, fakes.prisma);
    const result = await svc.runScan('TRUSTED-ORG-ID', 'AR');

    expect(result.scanLogId).toBe('scanlog-1');
    expect(result.status).toBe('COMPLETED');
    expect(result.alertsFound).toBe(1);
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
        costUsd: '0',
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

    const { svc } = makeService(rootAgent, fakes.prisma);
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

    const { svc, emit } = makeService(rootAgent, fakes.prisma);
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
    const { svc } = makeService(rootAgent, fakes.prisma, emit);

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
    const { svc, emit } = makeService(rootAgent, fakes.prisma);

    await expect(svc.runScan('org-4')).rejects.toThrow('db down');
    expect(emit).not.toHaveBeenCalled();
  });
});
