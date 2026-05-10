/**
 * MVP-5 ScanScheduler — global hourly `@Cron` tick that iterates orgs with
 * a `Settings` row, asks `shouldScanNow(settings, now)`, and fires
 * `ScanService.runScan(orgId, jurisdiction)` fire-and-forget.
 *
 * MVP-12 (scheduler-per-org): now jurisdiction-aware. For each org the tick
 * parses `Settings.jurisdictions`, filters to `SUPPORTED_JURISDICTIONS`, and
 * dispatches one `runScan` per matching jurisdiction. Orgs with an empty
 * jurisdictions array are skipped with a warning. The global `@Cron` tick is
 * the permanent scheduling surface (no per-org `SchedulerRegistry` needed).
 *
 * Spec: sdd/scanner-vertical-ar/spec R-7;
 *       sdd/scheduler-per-org/spec R-Scheduler-*.
 * Design: sdd/scanner-vertical-ar/design ADR-3 + ADR-4;
 *         sdd/scheduler-per-org/design.
 *
 * Concurrency: per-org:jurisdiction dedup is handled inside
 * `ScanService.runScan` (ADR-6 mutex with key `${orgId}:${jurisdiction}`).
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
import { SUPPORTED_JURISDICTIONS } from '@regwatch/types';

export type SupportedJurisdiction = (typeof SUPPORTED_JURISDICTIONS)[number];

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
   * honors `Settings.scanHour ∈ 0..23`.
   *
   * Single-replica assumption MVP-5: a second replica would double-tick.
   * Per-org:jurisdiction mutex (ADR-6) limits damage to a brief window.
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
          settings: {
            select: {
              scanSchedule: true,
              scanDay: true,
              scanDayOfMonth: true,
              scanHour: true,
              jurisdictions: true,
            },
          },
        },
      });

      for (const org of orgs) {
        evaluated += 1;
        // Never lazy-create Settings here — owned by R-Settings-Get-Lazy-Create.
        if (!org.settings) continue;

        // Parse jurisdictions — stored as JSONB in the canonical
        // `{ code, enabled, customTopics? }[]` shape (SettingsJurisdictionsSchema).
        // Handle both the canonical object shape and a legacy plain-string array
        // so existing rows from earlier migrations still dispatch correctly.
        let jurisdictions: string[];
        try {
          const raw = org.settings.jurisdictions;
          const items = Array.isArray(raw) ? raw : JSON.parse(raw as string);
          jurisdictions = (items as Array<{ code: string; enabled: boolean } | string>)
            .filter((j) => typeof j === 'string' || j.enabled)
            .map((j) => (typeof j === 'string' ? j : j.code));
        } catch {
          jurisdictions = [];
        }

        if (jurisdictions.length === 0) {
          this.logger.warn(`runTick: org=${org.id} has empty jurisdictions — skipping`);
          continue;
        }

        if (!shouldScanNow(org.settings, now)) continue;

        for (const jurisdiction of jurisdictions) {
          if (!(SUPPORTED_JURISDICTIONS as readonly string[]).includes(jurisdiction)) {
            this.logger.warn(
              `runTick: org=${org.id} jurisdiction=${jurisdiction} is not supported — skipping`,
            );
            continue;
          }

          dispatched += 1;
          // Fire-and-forget. Per-org:jurisdiction mutex inside runScan dedups
          // vs concurrent manual trigger; logger.error inside runScan handles
          // observability.
          this.scan.runScan(org.id, jurisdiction).catch((err) => {
            this.logger.error(
              `runScan(${org.id}, ${jurisdiction}) rejected from scheduler tick: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          });
        }
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
