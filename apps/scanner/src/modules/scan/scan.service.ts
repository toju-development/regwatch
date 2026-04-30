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
 * B4 scope (this file):
 *   - Pre-scan monthly cap gate (R-5) via `USAGE_HELPER.getMonthlyUsage`. At-cap
 *     orgs persist a `SKIPPED_CAP_EXCEEDED` ScanLog (no LLM call) and emit
 *     `scan.completed` so dashboards reflect the skip.
 *   - Real `costUsd`/`tokensUsed` from `COST_HELPER.computeCostFromUsageMetadata`
 *     (R-6, R-14, INV-SP-3 — Decimal end-to-end).
 *   - Per-org in-memory mutex (ADR-6 dedup): concurrent `runScan(sameOrg)` calls
 *     await the same in-flight promise, so at-most-one scan can race past the
 *     cap gate per org per process. MVP-5 single-replica assumption — a Redis
 *     lock lands when MVP-12 needs N replicas.
 *
 * B5 will add: `@Cron` scheduler + `POST /scan/trigger` controller.
 *
 * Foot-gun #667 (tsx + NestJS DI): every constructor arg uses explicit
 * `@Inject(TOKEN)`. Constructor-typed-class injection is UNRELIABLE under tsx.
 *
 * Spec: sdd/scanner-vertical-ar/spec R-1, R-3, R-4, R-5, R-6, R-9, R-10, R-14.
 * Design: sdd/scanner-vertical-ar/design ADR-2, ADR-5, ADR-6, ADR-9, ADR-14, ADR-15.
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
import { COST_HELPER, DEDUP_HELPER, ROOT_AGENT_FACTORY, USAGE_HELPER } from './tokens.js';
import type { RootAgent } from './agents/root.agent.js';
import { assertNoOrganizationId } from './agents/finding.schema.js';
import type { dedupFindings as DedupFn } from './utils/dedup.helper.js';
import { computeSourceUrlHash } from './utils/dedup.helper.js';
import type {
  computeCostFromUsageMetadata as ComputeCostFn,
  GeminiUsageMetadata,
} from './utils/cost.helper.js';
import type { getMonthlyUsage as GetMonthlyUsageFn } from '@regwatch/db/usage';

export interface DedupHelper {
  dedupFindings: typeof DedupFn;
}

export interface CostHelper {
  computeCostFromUsageMetadata: typeof ComputeCostFn;
}

export interface UsageHelper {
  getMonthlyUsage: typeof GetMonthlyUsageFn;
}

export interface ScanRunResult {
  scanLogId: string;
  status: ScanCompletedStatus;
  alertsFound: number;
  tokensUsed: number;
  /** `Prisma.Decimal` serialized as string (e.g. `'0.0275'`). INV-SP-3. */
  costUsd: string;
  errorMsg: string | null;
}

@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);

  /**
   * Per-org in-flight scan dedup (ADR-6). Concurrent `runScan(sameOrg)` callers
   * await the SAME promise → guarantees at-most-one LLM call can race past the
   * cap gate per org per process.
   *
   * MVP-5: single-replica assumption. In-memory `Map`. Migrate to a Redis lock
   * (`SET NX PX`) when MVP-12 scales to N replicas — until then, a second
   * replica would breach R-5 by ~1 scan/cycle worst case.
   */
  private readonly orgMutex = new Map<string, Promise<ScanRunResult>>();

  constructor(
    @Inject(ROOT_AGENT_FACTORY) private readonly rootAgent: RootAgent,
    @Inject(DEDUP_HELPER) private readonly dedup: DedupHelper,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(USAGE_HELPER) private readonly usage: UsageHelper,
    @Inject(COST_HELPER) private readonly cost: CostHelper,
  ) {}

  /**
   * Run one scan for `(organizationId, jurisdiction)`. Per-org dedup applies.
   *
   * Flow:
   *   0. Mutex: if a scan for this org is in flight, return its promise (ADR-6).
   *   1. Cap gate (R-5): `getMonthlyUsage(orgId)`. If `isAtCap`, persist a
   *      `SKIPPED_CAP_EXCEEDED` ScanLog (no LLM call), emit, return early.
   *   2. Invoke RootAgent.
   *   3. Deterministic dedup pass on the agent output.
   *   4. `prisma.$transaction`: insert `ScanLog` (COMPLETED|FAILED) THEN
   *      `alert.createMany({ skipDuplicates: true })` keyed off the
   *      `@@unique([organizationId, sourceUrlHash])` gate (ADR-9).
   *   5. POST-commit: emit `scan.completed` (try/catch + log so a downstream
   *      listener cannot reverse a successful persist — D13 mirror).
   */
  async runScan(organizationId: string, jurisdiction = 'AR'): Promise<ScanRunResult> {
    const inFlight = this.orgMutex.get(organizationId);
    if (inFlight) {
      this.logger.debug(`runScan(${organizationId}) deduped — awaiting in-flight promise (ADR-6)`);
      return inFlight;
    }

    const promise = this.runScanInner(organizationId, jurisdiction).finally(() => {
      this.orgMutex.delete(organizationId);
    });
    this.orgMutex.set(organizationId, promise);
    return promise;
  }

  private async runScanInner(organizationId: string, jurisdiction: string): Promise<ScanRunResult> {
    const startedAt = new Date();

    // R-5 cap gate. Boundary semantics live in `getMonthlyUsage` (`>=` cap).
    const usage = await this.usage.getMonthlyUsage(this.prisma, organizationId);
    if (usage.isAtCap) {
      return this.persistSkippedCapExceeded({
        organizationId,
        jurisdiction,
        startedAt,
        currentUsd: usage.costUsd,
        capUsd: usage.capUsd,
      });
    }

    let tokensUsed = 0;
    let costUsd: Prisma.Decimal = new Prisma.Decimal(0);
    let agentErr: Error | null = null;
    let findings: Awaited<ReturnType<RootAgent['run']>>['findings'] = [];

    try {
      const result = await this.rootAgent.run({ jurisdiction });
      findings = this.dedup.dedupFindings(result.findings);
      // Belt-and-suspenders (R-3 / INV-SP-2): even though `FindingSchema`
      // strips `organizationId` at parse time, re-assert at the chokepoint
      // before the trusted `organizationId` is stamped onto rows. Catches
      // any future regression where the Zod parse is bypassed or the
      // schema accidentally allows the field through. A throw here is a
      // P0 tenant-isolation breach — fail LOUDLY, do not persist.
      assertNoOrganizationId(findings);
      const computed = this.cost.computeCostFromUsageMetadata(
        result.usageMetadata as GeminiUsageMetadata,
      );
      tokensUsed = computed.tokensUsed;
      costUsd = computed.costUsd;
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
          costUsd,
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

        if (alertsFound > 0) {
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
      costUsd: costUsd.toString(),
      startedAt: startedAt.toISOString(),
      completedAt: persisted.completedAt.toISOString(),
      errorMsg,
    };

    this.safeEmit(evt);

    return {
      scanLogId: persisted.scanLogId,
      status,
      alertsFound: persisted.alertsFound,
      tokensUsed,
      costUsd: costUsd.toString(),
      errorMsg,
    };
  }

  /**
   * R-5: cap exceeded → persist a `SKIPPED_CAP_EXCEEDED` ScanLog so dashboards
   * & history reflect the skip, then emit `scan.completed`. NO LLM call.
   * Tokens / cost both zero — the skip itself is free.
   */
  private async persistSkippedCapExceeded(input: {
    organizationId: string;
    jurisdiction: string;
    startedAt: Date;
    currentUsd: Prisma.Decimal;
    capUsd: Prisma.Decimal;
  }): Promise<ScanRunResult> {
    const { organizationId, jurisdiction, startedAt, currentUsd, capUsd } = input;
    const errorMsg = `monthly cap reached (${currentUsd.toString()}/${capUsd.toString()} USD)`;

    const scanLog = await this.prisma.scanLog.create({
      data: {
        organizationId,
        jurisdiction,
        status: 'SKIPPED_CAP_EXCEEDED',
        errorMsg,
        tokensUsed: 0,
        costUsd: new Prisma.Decimal(0),
        alertsFound: 0,
        startedAt,
        completedAt: new Date(),
      },
      select: { id: true, completedAt: true },
    });

    const evt: ScanCompletedEvent = {
      scanLogId: scanLog.id,
      organizationId,
      jurisdiction,
      status: 'SKIPPED_CAP_EXCEEDED',
      alertsFound: 0,
      tokensUsed: 0,
      costUsd: '0',
      startedAt: startedAt.toISOString(),
      completedAt: (scanLog.completedAt ?? new Date()).toISOString(),
      errorMsg,
    };
    this.safeEmit(evt);

    return {
      scanLogId: scanLog.id,
      status: 'SKIPPED_CAP_EXCEEDED',
      alertsFound: 0,
      tokensUsed: 0,
      costUsd: '0',
      errorMsg,
    };
  }

  /**
   * D13 mirror: a throwing listener MUST NOT bubble out and reverse a
   * successful persist (or, in the SKIPPED case, surface as a 500/cron failure).
   */
  private safeEmit(evt: ScanCompletedEvent): void {
    try {
      this.events.emit(SCAN_COMPLETED_EVENT, evt);
    } catch (err) {
      this.logger.error(
        `scan.completed listener threw for scanLog=${evt.scanLogId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
