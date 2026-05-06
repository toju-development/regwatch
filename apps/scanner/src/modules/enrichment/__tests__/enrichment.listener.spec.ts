/**
 * Unit tests for `EnrichmentListener.handleScanCompleted`.
 *
 * Validates:
 *   - Serial enrichAlert calls for all alertIds in the scan
 *   - Per-alert failure isolation (one failure → others still processed)
 *   - `enrichment.completed` event emitted exactly once per scan
 *
 * Spec: sdd/classifier-and-writer/spec R-9-Enrichment-Completed-Event,
 *   R-7-Per-Alert-Failure-Isolation.
 * Design: sdd/classifier-and-writer/design ADR-3, ADR-8.
 */
import 'reflect-metadata';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ENRICHMENT_COMPLETED_EVENT, type ScanCompletedEvent } from '@regwatch/types/events';
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

function makePrisma(alertIds: string[]) {
  return {
    alert: {
      findMany: vi.fn().mockResolvedValue(alertIds.map((id) => ({ id }))),
    },
  };
}

function makeListener(
  enrichAlertFn: (alertId: string, orgId: string) => Promise<void>,
  alertIds: string[] = ['alert-001', 'alert-002'],
) {
  const emitter = new EventEmitter2();
  const emitSpy = vi.spyOn(emitter, 'emit');

  const enrichmentService = {
    enrichAlert: vi.fn().mockImplementation(enrichAlertFn),
  } as unknown as EnrichmentService;

  const prisma = makePrisma(alertIds);

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
});
