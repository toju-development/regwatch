/**
 * `EnrichmentSweeper` — startup recovery for stuck Alert enrichment jobs.
 *
 * On `apps/scanner` boot, finds Alert rows whose `enrichmentStatus` is a
 * non-terminal in-progress state (PENDING, CLASSIFIED) AND whose
 * `createdAt` is more than 10 minutes old. For each, it re-triggers
 * `EnrichmentService.enrichAlert` so that transient failures (e.g. crashes
 * mid-pipeline) are recovered automatically on the next restart.
 *
 * ADR-7: startup sweeper only — no cron, no admin endpoint.
 * ADR-9: idempotency rules inside `EnrichmentService` prevent double-enrichment
 *   for alerts that are already in a terminal state.
 *
 * Failure isolation: a per-alert try/catch ensures one failing alert never
 * blocks the others. Failures are logged at WARN level.
 *
 * Fire-and-forget: `onApplicationBootstrap` does NOT block the app startup
 * chain — the sweep Promise is detached after logging completion.
 *
 * Foot-gun #667 (tsx + NestJS DI): all constructor args use explicit
 * `@Inject(TOKEN)`. Constructor-typed-class injection is unreliable under tsx.
 *
 * Spec: sdd/classifier-and-writer/spec. Design: ADR-7.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@regwatch/db/client';

import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';
import { ENRICHMENT_SERVICE } from './tokens.js';
import type { EnrichmentService } from './enrichment.service.js';

/** Non-terminal enrichment statuses that indicate a stuck job. */
const STUCK_STATUSES = ['PENDING', 'CLASSIFIED'] as const;

/** Alerts older than this threshold (ms) are considered stuck. */
const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

@Injectable()
export class EnrichmentSweeper {
  private readonly logger = new Logger(EnrichmentSweeper.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(ENRICHMENT_SERVICE) private readonly enrichmentService: EnrichmentService,
  ) {}

  onApplicationBootstrap(): void {
    // Fire-and-forget: detach sweep so it does NOT block app startup.
    void this.sweep();
  }

  private async sweep(): Promise<void> {
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);

    const stuck = await this.prisma.alert.findMany({
      where: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        enrichmentStatus: { in: STUCK_STATUSES as unknown as any },
        createdAt: { lt: cutoff },
      },
      select: { id: true, organizationId: true },
    });

    if (stuck.length === 0) {
      this.logger.log('EnrichmentSweeper: no stuck alerts found — nothing to recover');
      return;
    }

    this.logger.log(`EnrichmentSweeper: sweeping ${stuck.length} stuck alert(s)`);

    let swept = 0;
    for (const alert of stuck) {
      try {
        await this.enrichmentService.enrichAlert(alert.id, alert.organizationId);
        swept++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`EnrichmentSweeper: failed to re-enrich alert=${alert.id}: ${msg}`);
      }
    }

    this.logger.log(
      `EnrichmentSweeper: sweep complete — ${swept}/${stuck.length} alert(s) re-enriched`,
    );
  }
}
