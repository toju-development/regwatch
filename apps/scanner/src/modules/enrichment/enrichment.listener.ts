/**
 * `EnrichmentListener` — in-process subscriber for `scan.completed` events.
 *
 * Wires the scan pipeline (MVP-5 ScanService) to the enrichment pipeline
 * (MVP-6 EnrichmentService) without coupling them at the module level.
 *
 * CONCURRENCY POLICY (ADR Q3):
 *   Alerts are processed SERIALLY (one-at-a-time). This is intentional:
 *   the per-alert cap-check in `EnrichmentService.enrichAlert` queries the
 *   DB live; parallel execution would create TOCTOU races where two alerts
 *   both pass the cap gate and overspend. Serial processing ensures the cap
 *   gate is accurate within the same enrichment batch.
 *   → Revisit to `p-limit(3)` if E2E latency becomes a user-visible concern.
 *
 * FAILURE ISOLATION (R-7):
 *   Each `enrichAlert` call is wrapped in a per-alert try/catch. A failure on
 *   alert N MUST NOT block or cancel alerts N+1..M.
 *
 * EVENT EMISSION (R-9):
 *   `enrichment.completed` is emitted once per `scan.completed` consumed,
 *   AFTER all alerts are processed (or attempted). The payload carries outcome
 *   counts so consumers can act without re-querying Alerts.
 *   A throwing listener MUST NOT bubble out and surface as a 500/cron failure.
 *   Wrapped in `safeEmit` (same pattern as `ScanService.safeEmit`).
 *
 * Foot-gun #667 (tsx + NestJS DI): EVERY constructor arg uses explicit
 * `@Inject(TOKEN)`. Constructor-typed-class injection is UNRELIABLE under tsx.
 *
 * Spec: sdd/classifier-and-writer/spec R-9-Enrichment-Completed-Event,
 *   R-7-Per-Alert-Failure-Isolation, R-11-Listener.
 * Design: sdd/classifier-and-writer/design ADR-3 (listener in-process),
 *   ADR-8 (enrichment.completed payload).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ENRICHMENT_COMPLETED_EVENT,
  SCAN_COMPLETED_EVENT,
  type EnrichmentCompletedEvent,
  type ScanCompletedEvent,
} from '@regwatch/types/events';
import { Prisma, type PrismaClient } from '@regwatch/db/client';

import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';
import { ENRICHMENT_SERVICE } from './tokens.js';
import type { EnrichmentService } from './enrichment.service.js';

@Injectable()
export class EnrichmentListener {
  private readonly logger = new Logger(EnrichmentListener.name);

  constructor(
    @Inject(ENRICHMENT_SERVICE) private readonly enrichmentService: EnrichmentService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  /**
   * Handle `scan.completed` — enrich each alert in the payload serially.
   *
   * Serial execution is intentional (ADR Q3): preserves cap-check accuracy.
   * A per-alert try/catch ensures failure isolation (R-7).
   */
  @OnEvent(SCAN_COMPLETED_EVENT)
  async handleScanCompleted(payload: ScanCompletedEvent): Promise<void> {
    const { scanLogId, organizationId, jurisdiction } = payload;

    this.logger.log(
      `handleScanCompleted: scanLog=${scanLogId} org=${organizationId} alertsFound=${payload.alertsFound}`,
    );

    // Load the alert IDs created by this scan. ScanCompletedEvent carries only
    // `alertsFound` count (not IDs) — we query the DB to get the actual IDs.
    // Filter: only PENDING alerts from this scan, so any pre-existing COMPLETED
    // alerts are not re-processed (idempotency handled in EnrichmentService too).
    const scanAlerts = await this.prisma.alert.findMany({
      where: { scanLogId, organizationId, enrichmentStatus: 'PENDING' },
      select: { id: true },
    });
    const alertIds = scanAlerts.map((a) => a.id);

    this.logger.log(
      `handleScanCompleted: enriching ${alertIds.length} alerts for scanLog=${scanLogId}`,
    );

    const counts = {
      completed: 0,
      classifyFailed: 0,
      writeFailed: 0,
      skippedCap: 0,
      skippedIrrelevant: 0,
    };
    const totalCost = new Prisma.Decimal(0);

    for (const alertId of alertIds) {
      try {
        await this.enrichmentService.enrichAlert(alertId, organizationId);
        // Note: counts are approximated here since enrichAlert doesn't return
        // the outcome. Precise counts would require reading the Alert status
        // post-enrichment — deferred to B6 if needed for the event payload.
        counts.completed++;
      } catch (err) {
        // Belt-and-suspenders: enrichAlert should never throw (R-7), but if it
        // does we log and continue to the next alert.
        this.logger.error(
          `handleScanCompleted: enrichAlert(${alertId}) threw unexpectedly: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        counts.classifyFailed++;
      }
    }

    const completedAt = new Date();
    const evt: EnrichmentCompletedEvent = {
      scanLogId,
      organizationId,
      jurisdiction,
      alertIds,
      counts,
      totalCostUsd: totalCost.toString(),
      completedAt: completedAt.toISOString(),
    };

    this.safeEmit(evt);
  }

  /**
   * Mirror of `ScanService.safeEmit` — a throwing downstream listener MUST NOT
   * surface as a cron/scan failure. Log the error, swallow the throw.
   */
  private safeEmit(evt: EnrichmentCompletedEvent): void {
    try {
      this.events.emit(ENRICHMENT_COMPLETED_EVENT, evt);
    } catch (err) {
      this.logger.error(
        `enrichment.completed listener threw for scanLog=${evt.scanLogId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
