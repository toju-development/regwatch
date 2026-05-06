/**
 * `EnrichmentService` — the MVP-6 chokepoint that enriches ONE `Alert` row
 * through the Classifier → Writer pipeline.
 *
 * SECURITY INVARIANT (R-6 / INV-AE-1):
 *   `organizationId` is TRUSTED INPUT from the listener (ScanCompletedEvent).
 *   It is stamped onto every `EnrichmentLog` row at write time. NEVER read
 *   from LLM output (assertNoForbiddenKeys walker guards this after Zod parse).
 *
 * IDEMPOTENCY (ADR-9):
 *   Re-enrichment is allowed from terminal-but-retryable states:
 *     PENDING, CLASSIFY_FAILED, WRITE_FAILED, SKIPPED_CAP_EXCEEDED.
 *   Early-return (skip) for intentional terminal states:
 *     COMPLETED, SKIPPED_IRRELEVANT.
 *
 * STATE MACHINE (R-8):
 *   PENDING
 *     → cap-check fails → SKIPPED_CAP_EXCEEDED (terminal)
 *     → classifier fails → CLASSIFY_FAILED (terminal, retryable)
 *     → classifier ok + NOT relevant → CLASSIFIED → SKIPPED_IRRELEVANT (terminal)
 *     → classifier ok + relevant → CLASSIFIED
 *       → cap-check fails → SKIPPED_CAP_EXCEEDED (terminal)
 *       → writer fails → WRITE_FAILED (terminal, retryable)
 *       → writer ok → COMPLETED (terminal)
 *
 * FAILURE ISOLATION (R-7):
 *   Per-alert try/catch. A failure on this alert MUST NOT propagate to caller.
 *   The caller (EnrichmentListener) is responsible for isolating alerts further.
 *
 * Foot-gun #667 (tsx + NestJS DI): EVERY constructor arg uses explicit
 * `@Inject(TOKEN)`. Constructor-typed-class injection is UNRELIABLE under tsx.
 *
 * Spec: sdd/classifier-and-writer/spec R-5 (cap), R-6 (trust), R-7 (isolation),
 *   R-8 (lifecycle), ADR-9 (idempotency).
 * Design: sdd/classifier-and-writer/design ADR-1, ADR-6, ADR-9, ADR-10, ADR-11,
 *   ADR-12 (cost attribution), ADR-13 (pricing in scanner).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@regwatch/db/client';
import type { getMonthlyUsage as GetMonthlyUsageFn } from '@regwatch/db/usage';
import { AlertTopic } from '@regwatch/types';
import type { AlertTopicValue } from '@regwatch/types';

import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';
import { USAGE_HELPER } from '../scan/tokens.js';
import { CLASSIFIER_AGENT_FACTORY, WRITER_AGENT_FACTORY } from './tokens.js';
import type { ClassifierAgentFactory } from './agents/classifier.factory.js';
import type { WriterAgentFactory } from './agents/writer.factory.js';
import { runClassifier } from './agents/classifier.runner.js';
import { runWriter } from './agents/writer.runner.js';
import { resolveOutputLanguage } from './utils/language.helper.js';
import { estimateEnrichmentCost } from '../scan/utils/cost.helper.js';

export interface UsageHelper {
  getMonthlyUsage: typeof GetMonthlyUsageFn;
}

/** All AlertTopic values — injected into Classifier prompt at call time (ADR-4 / INV-AE-4). */
const ALL_TOPICS: AlertTopicValue[] = Object.values(AlertTopic) as AlertTopicValue[];

@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(CLASSIFIER_AGENT_FACTORY) private readonly classifierFactory: ClassifierAgentFactory,
    @Inject(WRITER_AGENT_FACTORY) private readonly writerFactory: WriterAgentFactory,
    @Inject(USAGE_HELPER) private readonly usage: UsageHelper,
  ) {}

  /**
   * Enrich a single Alert through the Classifier → Writer pipeline.
   *
   * This is the chokepoint. Each step is isolated: a failure sets a terminal
   * status on the Alert, writes an `EnrichmentLog` row with error detail, and
   * returns (never throws). The listener loop continues to the next alert.
   *
   * Trust: `organizationId` comes from the listener (trusted). It is stamped
   * onto `EnrichmentLog` rows and NEVER read from LLM output.
   */
  async enrichAlert(alertId: string, organizationId: string): Promise<void> {
    // ── 1. Load Alert row ──────────────────────────────────────────────────
    // Include scanLog to get jurisdiction for language resolution (R-4).
    const alert = await this.prisma.alert.findUnique({
      where: { id: alertId, organizationId },
      select: {
        id: true,
        organizationId: true,
        title: true,
        summary: true,
        source: true,
        enrichmentStatus: true,
        scanLog: { select: { jurisdiction: true } },
      },
    });

    if (!alert) {
      this.logger.warn(`enrichAlert: alert ${alertId} not found — skipping`);
      return;
    }

    // ── 2. Idempotency check (ADR-9) ──────────────────────────────────────
    if (alert.enrichmentStatus === 'COMPLETED' || alert.enrichmentStatus === 'SKIPPED_IRRELEVANT') {
      this.logger.debug(
        `enrichAlert: alert ${alertId} already terminal (${alert.enrichmentStatus}), skipping`,
      );
      return;
    }

    // ── Resolve language (R-4) ─────────────────────────────────────────────
    const jurisdiction = alert.scanLog?.jurisdiction ?? 'AR';
    const settings = await this.prisma.settings.findUnique({
      where: { organizationId },
      select: { outputLanguage: true },
    });
    const language = resolveOutputLanguage(jurisdiction, settings?.outputLanguage ?? null);

    // ── 3. Cap check pre-Classifier (R-5 / ADR-6) ─────────────────────────
    const usagePre = await this.usage.getMonthlyUsage(this.prisma, organizationId);
    if (usagePre.isAtCap) {
      this.logger.debug(
        `enrichAlert: org ${organizationId} at cap before classifier — alert ${alertId} skipped`,
      );
      await this.persistCapExceeded(alertId, organizationId, 'classifier');
      return;
    }

    // ── 4. Run Classifier ─────────────────────────────────────────────────
    try {
      const classifierAgent = this.classifierFactory({});
      const { output, tokensIn, tokensOut } = await runClassifier(
        classifierAgent,
        {
          id: alert.id,
          title: alert.title ?? '',
          summary: alert.summary ?? '',
          sourceId: alert.source as string,
        },
        ALL_TOPICS,
        language,
      );

      const { costUsd } = estimateEnrichmentCost(tokensIn, tokensOut, 'classifier');

      // Stamp classifier output onto Alert (trusted caller stamps org, NOT LLM)
      await this.prisma.alert.update({
        where: { id: alertId },
        data: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          topic: output.topic as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          severity: output.severity as any,
          relevanceScore: output.relevanceScore,
          relevant: output.relevant,
          classifiedAt: new Date(),
          enrichmentStatus: 'CLASSIFIED',
          enrichmentError: null,
        },
      });

      await this.prisma.enrichmentLog.create({
        data: {
          organizationId,
          alertId,
          agent: 'classifier',
          tokensInput: tokensIn,
          tokensOutput: tokensOut,
          costUsd,
          status: 'CLASSIFIED',
        },
      });

      // ── 5. Relevance gate (R-2) ──────────────────────────────────────────
      if (!output.relevant) {
        await this.prisma.alert.update({
          where: { id: alertId },
          data: { enrichmentStatus: 'SKIPPED_IRRELEVANT' },
        });
        return;
      }

      // ── 6. Cap check pre-Writer (R-5 / ADR-6) ───────────────────────────
      const usagePreWriter = await this.usage.getMonthlyUsage(this.prisma, organizationId);
      if (usagePreWriter.isAtCap) {
        this.logger.debug(
          `enrichAlert: org ${organizationId} at cap before writer — alert ${alertId} skipped`,
        );
        await this.persistCapExceeded(alertId, organizationId, 'writer');
        return;
      }

      // ── 7. Run Writer ───────────────────────────────────────────────────
      try {
        const writerAgent = this.writerFactory({});
        const {
          output: writerOutput,
          tokensIn: wIn,
          tokensOut: wOut,
        } = await runWriter(
          writerAgent,
          {
            id: alert.id,
            title: alert.title ?? '',
            summary: alert.summary ?? '',
            topic: output.topic,
            severity: output.severity,
          },
          language,
          alert.summary ?? '',
        );

        const { costUsd: writerCost } = estimateEnrichmentCost(wIn, wOut, 'writer');

        await this.prisma.alert.update({
          where: { id: alertId },
          data: {
            executiveSummary: writerOutput.executiveSummary,
            whatChangesForYou: writerOutput.whatChangesForYou,
            citations: writerOutput.citations,
            writtenAt: new Date(),
            enrichmentStatus: 'COMPLETED',
            enrichmentError: null,
          },
        });

        await this.prisma.enrichmentLog.create({
          data: {
            organizationId,
            alertId,
            agent: 'writer',
            tokensInput: wIn,
            tokensOutput: wOut,
            costUsd: writerCost,
            status: 'COMPLETED',
          },
        });
      } catch (writerErr) {
        // ── 8. Writer failure path ─────────────────────────────────────────
        const msg = writerErr instanceof Error ? writerErr.message : String(writerErr);
        this.logger.warn(`enrichAlert writer failed for alert=${alertId}: ${msg}`);
        await this.prisma.alert.update({
          where: { id: alertId },
          data: { enrichmentStatus: 'WRITE_FAILED', enrichmentError: msg },
        });
        await this.prisma.enrichmentLog.create({
          data: {
            organizationId,
            alertId,
            agent: 'writer',
            tokensInput: 0,
            tokensOutput: 0,
            costUsd: new Prisma.Decimal(0),
            status: 'WRITE_FAILED',
            errorMsg: msg,
          },
        });
      }
    } catch (classifyErr) {
      // ── 8. Classifier failure path ────────────────────────────────────────
      const msg = classifyErr instanceof Error ? classifyErr.message : String(classifyErr);
      this.logger.warn(`enrichAlert classifier failed for alert=${alertId}: ${msg}`);
      await this.prisma.alert.update({
        where: { id: alertId },
        data: { enrichmentStatus: 'CLASSIFY_FAILED', enrichmentError: msg },
      });
      await this.prisma.enrichmentLog.create({
        data: {
          organizationId,
          alertId,
          agent: 'classifier',
          tokensInput: 0,
          tokensOutput: 0,
          costUsd: new Prisma.Decimal(0),
          status: 'CLASSIFY_FAILED',
          errorMsg: msg,
        },
      });
    }
  }

  /**
   * Shared helper: cap-exceeded path for either agent.
   * Sets `enrichmentStatus = SKIPPED_CAP_EXCEEDED` on Alert and writes a
   * zero-cost `EnrichmentLog` row. Also stamps `Settings.lastSkippedCapAt`
   * (migration #10) so the usage widget can surface the last skip time.
   */
  private async persistCapExceeded(
    alertId: string,
    organizationId: string,
    agent: 'classifier' | 'writer',
  ): Promise<void> {
    await this.prisma.alert.update({
      where: { id: alertId },
      data: { enrichmentStatus: 'SKIPPED_CAP_EXCEEDED' },
    });
    await this.prisma.enrichmentLog.create({
      data: {
        organizationId,
        alertId,
        agent,
        tokensInput: 0,
        tokensOutput: 0,
        costUsd: new Prisma.Decimal(0),
        status: 'SKIPPED_CAP_EXCEEDED',
      },
    });
    // MVP-6 B5.4: stamp lastSkippedCapAt on Settings (upsert in case row not yet created).
    await this.prisma.settings.upsert({
      where: { organizationId },
      update: { lastSkippedCapAt: new Date() },
      create: {
        organizationId,
        jurisdictions: [],
        lastSkippedCapAt: new Date(),
      },
    });
  }
}
