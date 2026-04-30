/**
 * `ScanService` — the MVP-5 chokepoint that runs ONE end-to-end scan for a
 * single organization and one jurisdiction.
 *
 * SECURITY INVARIANT (R-3 / INV-SP-2):
 *   `orgId` is TRUSTED INPUT from the caller (cron tick or `POST /scan/trigger`
 *   controller after the 4-guard chain). The agent's `Finding[]` output is
 *   untrusted text — `FindingSchema` deliberately omits `organizationId` so an
 *   LLM hallucination CANNOT cross the tenant boundary. This service stamps
 *   the trusted `orgId` onto every `Alert` row at write time. Touching this
 *   contract (e.g. reading `organizationId` from agent output) is a P0 bug.
 *
 * B3 scope (this file):
 *   - Run RootAgent → dedup → `$transaction` ScanLog + Alerts → POST-commit emit.
 *   - Cost computation + monthly cap-check land in B4 (`costUsd`/`tokensUsed`
 *     persisted from agent usageMetadata; `costUsd` stays `Decimal(0)` until
 *     `COST_HELPER` arrives — see TODO-B4 below).
 *   - `@Cron` scheduler + `POST /scan/trigger` controller land in B5.
 *
 * Foot-gun #667 (tsx + NestJS DI): every constructor arg uses explicit
 * `@Inject(TOKEN)`. Constructor-typed-class injection is UNRELIABLE under tsx.
 *
 * Spec: sdd/scanner-vertical-ar/spec R-1, R-3, R-4, R-9, R-10.
 * Design: sdd/scanner-vertical-ar/design ADR-2, ADR-9, ADR-14, ADR-15.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, type PrismaClient } from '@regwatch/db/client';
import {
  SCAN_COMPLETED_EVENT,
  type ScanCompletedEvent,
  type ScanCompletedStatus,
} from '@regwatch/types/events';

import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';
import { ROOT_AGENT_FACTORY, DEDUP_HELPER } from './tokens.js';
import type { RootAgent } from './agents/root.agent.js';
import type { dedupFindings as DedupFn } from './utils/dedup.helper.js';
import { computeSourceUrlHash } from './utils/dedup.helper.js';

export interface DedupHelper {
  dedupFindings: typeof DedupFn;
}

export interface ScanRunResult {
  scanLogId: string;
  status: ScanCompletedStatus;
  alertsFound: number;
  tokensUsed: number;
  /** `Prisma.Decimal` serialized as string. Always `'0'` in B3 (TODO-B4). */
  costUsd: string;
  errorMsg: string | null;
}

@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);

  constructor(
    @Inject(ROOT_AGENT_FACTORY) private readonly rootAgent: RootAgent,
    @Inject(DEDUP_HELPER) private readonly dedup: DedupHelper,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  /**
   * Run one scan for `(organizationId, jurisdiction)`.
   *
   * Order:
   *   1. Invoke RootAgent (no DB writes — pure agent call).
   *   2. Deterministic dedup pass on the agent output.
   *   3. `prisma.$transaction`: insert `ScanLog` (COMPLETED) THEN
   *      `alert.createMany({ skipDuplicates: true })` keyed off the
   *      `@@unique([organizationId, sourceUrlHash])` gate (race-safe across
   *      processes per ADR-9).
   *   4. POST-commit: emit `scan.completed` (try/catch + log so a downstream
   *      listener cannot reverse a successful persist — mirrors capability/
   *      settings D13).
   *
   * Failure handling: any throw before/within the transaction is converted
   * into a `FAILED` ScanLog row + emitted event with `errorMsg`.
   *
   * B4 will inject `USAGE_HELPER` for the pre-scan cap-check (R-5) and
   * `COST_HELPER` to populate real `costUsd` from `usageMetadata`. Until then
   * `tokensUsed` is faithfully persisted (free signal) and `costUsd` stays
   * `Decimal(0)`.
   */
  async runScan(organizationId: string, jurisdiction = 'AR'): Promise<ScanRunResult> {
    const startedAt = new Date();
    let tokensUsed = 0;
    let agentErr: Error | null = null;
    let findings: Awaited<ReturnType<RootAgent['run']>>['findings'] = [];

    try {
      const result = await this.rootAgent.run({ jurisdiction });
      findings = this.dedup.dedupFindings(result.findings);
      tokensUsed = result.usageMetadata.totalTokenCount;
    } catch (err) {
      agentErr = err instanceof Error ? err : new Error(String(err));
      this.logger.warn(
        `RootAgent failed for org=${organizationId} jur=${jurisdiction}: ${agentErr.message}`,
      );
    }

    const status: ScanCompletedStatus = agentErr ? 'FAILED' : 'COMPLETED';
    const errorMsg = agentErr?.message ?? null;

    // Single $transaction = single COMMIT boundary. Returning a value from
    // the callback resolves the outer Promise AFTER the commit lands.
    const persisted = await this.prisma.$transaction(async (tx) => {
      const scanLog = await tx.scanLog.create({
        data: {
          organizationId,
          jurisdiction,
          status,
          errorMsg,
          tokensUsed,
          // TODO-B4: replace with COST_HELPER.compute(usageMetadata).
          costUsd: new Prisma.Decimal(0),
          alertsFound: 0,
          startedAt,
          completedAt: new Date(),
        },
        select: { id: true, completedAt: true },
      });

      let alertsFound = 0;
      if (!agentErr && findings.length > 0) {
        // R-3: stamp the TRUSTED `organizationId` here. Agent output never
        // carried it (FindingSchema enforces). `skipDuplicates:true` honors
        // the @@unique([organizationId, sourceUrlHash]) gate (ADR-9).
        const rows = findings.map((f) => ({
          organizationId,
          source: f.source,
          sourceUrl: f.sourceUrl,
          sourceUrlHash: computeSourceUrlHash(f.sourceUrl),
          title: f.title,
          summary: f.summary,
          publishedAt: f.publishedAt ? new Date(f.publishedAt) : null,
          scanLogId: scanLog.id,
        }));
        const result = await tx.alert.createMany({ data: rows, skipDuplicates: true });
        alertsFound = result.count;

        if (alertsFound !== rows.length) {
          await tx.scanLog.update({
            where: { id: scanLog.id },
            data: { alertsFound },
          });
        } else if (alertsFound > 0) {
          await tx.scanLog.update({
            where: { id: scanLog.id },
            data: { alertsFound },
          });
        }
      }

      return {
        scanLogId: scanLog.id,
        completedAt: scanLog.completedAt ?? new Date(),
        alertsFound,
      };
    });

    const evt: ScanCompletedEvent = {
      scanLogId: persisted.scanLogId,
      organizationId,
      jurisdiction,
      status,
      alertsFound: persisted.alertsFound,
      tokensUsed,
      costUsd: '0',
      startedAt: startedAt.toISOString(),
      completedAt: persisted.completedAt.toISOString(),
      errorMsg,
    };

    try {
      this.events.emit(SCAN_COMPLETED_EVENT, evt);
    } catch (err) {
      // Mirrors capability/settings D13: row is committed; a throwing
      // listener MUST NOT bubble out as a 500/cron failure.
      this.logger.error(
        `scan.completed listener threw for scanLog=${persisted.scanLogId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return {
      scanLogId: persisted.scanLogId,
      status,
      alertsFound: persisted.alertsFound,
      tokensUsed,
      costUsd: '0',
      errorMsg,
    };
  }
}
