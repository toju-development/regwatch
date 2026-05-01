/**
 * MVP-5 ScanScheduler — global hourly `@Cron` tick that iterates orgs with
 * a `Settings` row, asks `shouldScanNow(settings, now)`, and fires
 * `ScanService.runScan(orgId)` fire-and-forget.
 *
 * DEPRECATED-IN-MVP-12: replace this single global cron with per-org
 * scheduler entries (TZ-aware) once `scheduler-per-org` lands. Until then
 * this is the WHOLE scheduling surface.
 *
 * Spec: sdd/scanner-vertical-ar/spec R-7.
 * Design: sdd/scanner-vertical-ar/design ADR-3 + ADR-4.
 *
 * Concurrency: per-org dedup is already handled inside `ScanService.runScan`
 * (ADR-6 mutex). The scheduler may legally double-fire across cron+manual
 * trigger paths — the mutex collapses to ONE in-flight scan per org.
 *
 * tsx + NestJS DI requires explicit `@Inject(TOKEN)` (foot-gun #667).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { PrismaClient } from '@regwatch/db/client';

import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';
import { SCAN_SERVICE } from './tokens.js';
import { ScanService } from './scan.service.js';
import { shouldScanNow } from './utils/cadence.helper.js';

/**
 * Soft warning threshold for tick latency. A tick that exceeds 30 minutes
 * indicates either a runaway in-flight scan blocking event-loop turns or a
 * Prisma stall — log loud so ops can investigate before the next tick races.
 */
const TICK_WARN_MS = 30 * 60 * 1000;

@Injectable()
export class ScanSchedulerService {
  private readonly logger = new Logger(ScanSchedulerService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(SCAN_SERVICE) private readonly scan: ScanService,
  ) {}

  /**
   * Hourly tick (UTC). Hour granularity is the coarsest cadence that still
   * honors `Settings.scanHour ∈ 0..23`. Per-org TZ is MVP-12.
   *
   * Single-replica assumption MVP-5: a second replica would double-tick.
   * Per-org mutex (ADR-6) limits damage to a brief window before settling.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'scanner-global', timeZone: 'UTC' })
  async tick(): Promise<void> {
    return this.runTick(new Date());
  }

  /**
   * Externalized for tests — invoke directly with a fixed `now` so we don't
   * depend on the cron registry firing.
   */
  async runTick(now: Date): Promise<void> {
    const startedMs = Date.now();
    let evaluated = 0;
    let dispatched = 0;

    try {
      const orgs = await this.prisma.organization.findMany({
        select: {
          id: true,
          settings: { select: { scanSchedule: true, scanDay: true, scanHour: true } },
        },
      });

      for (const org of orgs) {
        evaluated += 1;
        // Never lazy-create Settings here — owned by R-Settings-Get-Lazy-Create.
        if (!org.settings) continue;
        if (!shouldScanNow(org.settings, now)) continue;

        dispatched += 1;
        // Fire-and-forget. Per-org mutex inside runScan dedups vs concurrent
        // manual trigger; logger.error inside runScan handles observability.
        this.scan.runScan(org.id).catch((err) => {
          this.logger.error(
            `runScan(${org.id}) rejected from scheduler tick: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
      }
    } catch (err) {
      this.logger.error(
        `scheduler tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      const elapsed = Date.now() - startedMs;
      if (elapsed > TICK_WARN_MS) {
        this.logger.warn(
          `scheduler tick took ${elapsed}ms (>${TICK_WARN_MS}ms); evaluated=${evaluated} dispatched=${dispatched}`,
        );
      } else {
        this.logger.debug(
          `scheduler tick ok in ${elapsed}ms; evaluated=${evaluated} dispatched=${dispatched}`,
        );
      }
    }
  }
}
