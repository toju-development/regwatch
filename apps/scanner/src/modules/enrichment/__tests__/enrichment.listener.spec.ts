/**
 * Unit tests for `EnrichmentListener.handleScanCompleted`.
 *
 * Validates:
 *   - Serial enrichAlert calls for all alertIds in the scan
 *   - Per-alert failure isolation (one failure → others still processed)
 *   - `enrichment.completed` event emitted exactly once per scan
 *   - CF-MVP7-2: totalCostUsd reflects sum of EnrichmentLog.costUsd (not "0")
 *   - CF-MVP7-2: counts derived from post-loop DB Alert statuses
 *
 * Spec: sdd/classifier-and-writer/spec R-9-Enrichment-Completed-Event,
 *   R-7-Per-Alert-Failure-Isolation.
 * Design: sdd/classifier-and-writer/design ADR-3, ADR-8.
 */
import 'reflect-metadata';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@regwatch/db/client';
import {
  ENRICHMENT_COMPLETED_EVENT,
  type EnrichmentCompletedEvent,
  type ScanCompletedEvent,
} from '@regwatch/types/events';
import { describe, expect, it, vi } from 'vitest';

import { EnrichmentListener } from '../enrichment.listener.js';
import type { EnrichmentService } from '../enrichment.service.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID = 'org-001';
const SCAN_LOG_ID = 'scan-001';

function makePayload(overrides: Partial<ScanCompletedEvent> = {}): ScanCompletedEvent {
  return {
    scanLogId: SCAN_LOG_ID,
    organizationId: ORG_ID,
    jurisdiction: 'AR',
    status: 'COMPLETED',
    alertsFound: 2,
    tokensUsed: 500,
    costUsd: '0.001',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    errorMsg: null,
    ...overrides,
  };
}

interface AlertStatusRow {
  id: string;
  enrichmentStatus: string;
}

interface LogCostRow {
  costUsd: InstanceType<typeof Prisma.Decimal>;
}

function makePrisma(
  alertIds: string[],
  postLoopAlertStatuses: AlertStatusRow[] = [],
  postLoopLogCosts: LogCostRow[] = [],
) {
  // First call: pre-loop findMany returns alertIds (PENDING filter)
  // Second call: post-loop findMany returns enrichedAlerts with statuses
  const alertFindMany = vi
    .fn()
    .mockResolvedValueOnce(alertIds.map((id) => ({ id })))
    .mockResolvedValue(postLoopAlertStatuses);

  const enrichmentLogFindMany = vi.fn().mockResolvedValue(postLoopLogCosts);

  return {
    alert: { findMany: alertFindMany },
    enrichmentLog: { findMany: enrichmentLogFindMany },
    _mocks: { alertFindMany, enrichmentLogFindMany },
  };
}

function makeListener(
  enrichAlertFn: (alertId: string, orgId: string) => Promise<void>,
  alertIds: string[] = ['alert-001', 'alert-002'],
  postLoopAlertStatuses: AlertStatusRow[] = [],
  postLoopLogCosts: LogCostRow[] = [],
) {
  const emitter = new EventEmitter2();
  const emitSpy = vi.spyOn(emitter, 'emit');

  const enrichmentService = {
    enrichAlert: vi.fn().mockImplementation(enrichAlertFn),
  } as unknown as EnrichmentService;

  const prisma = makePrisma(alertIds, postLoopAlertStatuses, postLoopLogCosts);

  const listener = new EnrichmentListener(enrichmentService, emitter, prisma as never);

  return { listener, enrichmentService, emitter, emitSpy, prisma };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EnrichmentListener.handleScanCompleted', () => {
  describe('happy path', () => {
    it('calls enrichAlert for each alertId in order', async () => {
      const callOrder: string[] = [];
      const { listener, enrichmentService } = makeListener(async (id) => {
        callOrder.push(id);
      });

      await listener.handleScanCompleted(makePayload());

      expect((enrichmentService.enrichAlert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
      expect(callOrder).toEqual(['alert-001', 'alert-002']);
    });

    it('calls enrichAlert with (alertId, organizationId) from trusted payload', async () => {
      const { listener, enrichmentService } = makeListener(async () => {});

      await listener.handleScanCompleted(makePayload());

      const calls = (enrichmentService.enrichAlert as ReturnType<typeof vi.fn>).mock.calls;
      for (const [alertId, orgId] of calls) {
        expect(typeof alertId).toBe('string');
        expect(orgId).toBe(ORG_ID);
      }
    });

    it('emits enrichment.completed exactly once', async () => {
      const { listener, emitSpy } = makeListener(async () => {});

      await listener.handleScanCompleted(makePayload());

      const enrichmentEvents = emitSpy.mock.calls.filter(
        ([evt]) => evt === ENRICHMENT_COMPLETED_EVENT,
      );
      expect(enrichmentEvents.length).toBe(1);

      const emittedPayload = enrichmentEvents[0]![1] as {
        scanLogId: string;
        organizationId: string;
      };
      expect(emittedPayload.scanLogId).toBe(SCAN_LOG_ID);
      expect(emittedPayload.organizationId).toBe(ORG_ID);
    });
  });

  describe('failure isolation (R-7)', () => {
    it('one alert failing does not prevent the next alert from being processed', async () => {
      const processedIds: string[] = [];

      const { listener, enrichmentService } = makeListener(async (id) => {
        if (id === 'alert-001') {
          throw new Error('classifier exploded');
        }
        processedIds.push(id);
      });

      // Should not throw — listener isolates per-alert failures
      await expect(listener.handleScanCompleted(makePayload())).resolves.toBeUndefined();

      expect(processedIds).toContain('alert-002');
      // enrichAlert was still called twice (both alerts attempted)
      expect((enrichmentService.enrichAlert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    });

    it('enrichment.completed is still emitted even when alerts fail', async () => {
      const { listener, emitSpy } = makeListener(async (id) => {
        if (id === 'alert-001') throw new Error('bang');
      });

      await listener.handleScanCompleted(makePayload());

      const enrichmentEvents = emitSpy.mock.calls.filter(
        ([evt]) => evt === ENRICHMENT_COMPLETED_EVENT,
      );
      expect(enrichmentEvents.length).toBe(1);
    });
  });

  describe('empty alertIds', () => {
    it('emits enrichment.completed with empty alertIds when scan produced no alerts', async () => {
      const { listener, enrichmentService, emitSpy } = makeListener(async () => {}, []);

      await listener.handleScanCompleted(makePayload({ alertsFound: 0 }));

      expect((enrichmentService.enrichAlert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);

      const enrichmentEvents = emitSpy.mock.calls.filter(
        ([evt]) => evt === ENRICHMENT_COMPLETED_EVENT,
      );
      expect(enrichmentEvents.length).toBe(1);
    });
  });

  describe('CF-MVP7-2: accurate totalCostUsd and counts', () => {
    it('totalCostUsd reflects the sum of EnrichmentLog.costUsd entries, not "0"', async () => {
      const logCosts: LogCostRow[] = [
        { costUsd: new Prisma.Decimal('0.003') },
        { costUsd: new Prisma.Decimal('0.007') },
      ];
      const alertStatuses: AlertStatusRow[] = [
        { id: 'alert-001', enrichmentStatus: 'COMPLETED' },
        { id: 'alert-002', enrichmentStatus: 'COMPLETED' },
      ];

      const { listener, emitSpy } = makeListener(
        async () => {},
        ['alert-001', 'alert-002'],
        alertStatuses,
        logCosts,
      );

      await listener.handleScanCompleted(makePayload());

      const enrichmentEvents = emitSpy.mock.calls.filter(
        ([evt]) => evt === ENRICHMENT_COMPLETED_EVENT,
      );
      const evt = enrichmentEvents[0]![1] as EnrichmentCompletedEvent;

      expect(evt.totalCostUsd).toBe('0.01'); // 0.003 + 0.007
      expect(evt.totalCostUsd).not.toBe('0');
    });

    it('counts.completed is derived from DB Alert statuses, not naive loop increment', async () => {
      // Only 1 of 2 alerts completes; the other is skipped as irrelevant
      const alertStatuses: AlertStatusRow[] = [
        { id: 'alert-001', enrichmentStatus: 'COMPLETED' },
        { id: 'alert-002', enrichmentStatus: 'SKIPPED_IRRELEVANT' },
      ];

      const { listener, emitSpy } = makeListener(
        async () => {},
        ['alert-001', 'alert-002'],
        alertStatuses,
        [],
      );

      await listener.handleScanCompleted(makePayload());

      const enrichmentEvents = emitSpy.mock.calls.filter(
        ([evt]) => evt === ENRICHMENT_COMPLETED_EVENT,
      );
      const evt = enrichmentEvents[0]![1] as EnrichmentCompletedEvent;

      expect(evt.counts.completed).toBe(1);
      expect(evt.counts.skippedIrrelevant).toBe(1);
    });

    it('counts accurately tracks all terminal statuses', async () => {
      const alertIds = ['a1', 'a2', 'a3', 'a4', 'a5'];
      const alertStatuses: AlertStatusRow[] = [
        { id: 'a1', enrichmentStatus: 'COMPLETED' },
        { id: 'a2', enrichmentStatus: 'CLASSIFY_FAILED' },
        { id: 'a3', enrichmentStatus: 'WRITE_FAILED' },
        { id: 'a4', enrichmentStatus: 'SKIPPED_CAP_EXCEEDED' },
        { id: 'a5', enrichmentStatus: 'SKIPPED_IRRELEVANT' },
      ];

      const { listener, emitSpy } = makeListener(async () => {}, alertIds, alertStatuses, []);

      await listener.handleScanCompleted(makePayload({ alertsFound: 5 }));

      const enrichmentEvents = emitSpy.mock.calls.filter(
        ([evt]) => evt === ENRICHMENT_COMPLETED_EVENT,
      );
      const evt = enrichmentEvents[0]![1] as EnrichmentCompletedEvent;

      expect(evt.counts.completed).toBe(1);
      expect(evt.counts.classifyFailed).toBe(1);
      expect(evt.counts.writeFailed).toBe(1);
      expect(evt.counts.skippedCap).toBe(1);
      expect(evt.counts.skippedIrrelevant).toBe(1);
    });
  });
});
