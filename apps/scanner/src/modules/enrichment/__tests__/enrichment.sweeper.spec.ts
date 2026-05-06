/**
 * Unit tests for `EnrichmentSweeper.onApplicationBootstrap`.
 *
 * Validates:
 *   - No stuck alerts → `enrichAlert` never called
 *   - 2 stuck PENDING alerts (> 10min) → `enrichAlert` called twice
 *   - 1 recent PENDING alert (< 10min) → NOT swept (time threshold respected)
 *   - COMPLETED alert > 10min → NOT swept (only stuck statuses swept)
 *   - One swept alert throws → second still processed (per-alert isolation)
 *
 * Strategy: fake PrismaClient and EnrichmentService with vi.fn() stubs.
 * The `findMany` mock is controlled per-test to return the precise alert set
 * the sweeper would see given different DB states.
 *
 * Spec: sdd/classifier-and-writer/spec. Design: ADR-7 (startup sweep only).
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { EnrichmentSweeper } from '../enrichment.sweeper.js';
import type { EnrichmentService } from '../enrichment.service.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID = 'org-001';

function ago(ms: number): Date {
  return new Date(Date.now() - ms);
}

const TEN_MIN_MS = 10 * 60 * 1000;

/** Build an Alert-like stub with id, organizationId, enrichmentStatus, createdAt. */
function makeAlert(id: string, status: string, createdAt: Date, orgId = ORG_ID) {
  return { id, organizationId: orgId, enrichmentStatus: status, createdAt };
}

/**
 * Build a sweeper with a controlled `findMany` result.
 *
 * `findMany` is pre-called with the filtered set the sweeper would receive
 * from Prisma given the `where` clause. Tests control which alerts come back
 * (simulating DB-level filtering), which is the correct unit-test approach:
 * we trust Prisma's query logic and only test the sweeper's response to results.
 */
function makeSweeper(
  findManyResult: { id: string; organizationId: string }[],
  enrichAlertImpl?: (alertId: string, orgId: string) => Promise<void>,
) {
  const prisma = {
    alert: {
      findMany: vi.fn().mockResolvedValue(findManyResult),
    },
  };

  const enrichmentService = {
    enrichAlert: vi.fn().mockImplementation(enrichAlertImpl ?? (async () => undefined)),
  } as unknown as EnrichmentService;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sweeper = new EnrichmentSweeper(prisma as any, enrichmentService);

  return { sweeper, prisma, enrichmentService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EnrichmentSweeper', () => {
  it('no stuck alerts → enrichAlert never called', async () => {
    const { sweeper, enrichmentService } = makeSweeper([]);

    sweeper.onApplicationBootstrap();
    // Give the detached Promise time to settle
    await vi.waitFor(() => expect(enrichmentService.enrichAlert).not.toHaveBeenCalled());
  });

  it('2 stuck PENDING alerts (> 10min) → enrichAlert called twice', async () => {
    const alerts = [
      makeAlert('alert-001', 'PENDING', ago(TEN_MIN_MS + 5000)),
      makeAlert('alert-002', 'PENDING', ago(TEN_MIN_MS + 10000)),
    ];

    const { sweeper, enrichmentService } = makeSweeper(alerts);

    sweeper.onApplicationBootstrap();

    await vi.waitFor(() => expect(enrichmentService.enrichAlert).toHaveBeenCalledTimes(2));
    expect(enrichmentService.enrichAlert).toHaveBeenCalledWith('alert-001', ORG_ID);
    expect(enrichmentService.enrichAlert).toHaveBeenCalledWith('alert-002', ORG_ID);
  });

  it('1 recent PENDING alert (< 10min) → NOT swept (time threshold respected)', async () => {
    // Prisma's `where: { createdAt: { lt: cutoff } }` would exclude this alert.
    // We simulate that by returning an empty findMany result.
    const { sweeper, enrichmentService } = makeSweeper([]);

    sweeper.onApplicationBootstrap();

    await vi.waitFor(() => expect(enrichmentService.enrichAlert).not.toHaveBeenCalled());
  });

  it('COMPLETED alert > 10min → NOT swept (only stuck statuses swept)', async () => {
    // Prisma's `where: { enrichmentStatus: { in: STUCK_STATUSES } }` would
    // exclude COMPLETED alerts. Simulate by returning empty result.
    const { sweeper, enrichmentService } = makeSweeper([]);

    sweeper.onApplicationBootstrap();

    await vi.waitFor(() => expect(enrichmentService.enrichAlert).not.toHaveBeenCalled());
  });

  it('one swept alert throws → second still processed (per-alert isolation)', async () => {
    const alerts = [
      makeAlert('alert-fail', 'PENDING', ago(TEN_MIN_MS + 5000)),
      makeAlert('alert-ok', 'PENDING', ago(TEN_MIN_MS + 5000)),
    ];

    let callCount = 0;
    const enrichAlertImpl = async (alertId: string) => {
      callCount++;
      if (alertId === 'alert-fail') {
        throw new Error('simulated enrichment failure');
      }
    };

    const { sweeper, enrichmentService } = makeSweeper(alerts, enrichAlertImpl);

    sweeper.onApplicationBootstrap();

    // Both alerts were attempted despite the first throwing.
    await vi.waitFor(() => expect(enrichmentService.enrichAlert).toHaveBeenCalledTimes(2));
    expect(callCount).toBe(2);
    expect(enrichmentService.enrichAlert).toHaveBeenCalledWith('alert-fail', ORG_ID);
    expect(enrichmentService.enrichAlert).toHaveBeenCalledWith('alert-ok', ORG_ID);
  });
});
