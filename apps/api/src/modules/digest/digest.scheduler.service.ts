/**
 * DigestSchedulerService — cron entrypoint for the weekly digest.
 *
 * sdd/digest-export (POST-3) — task 5.1/5.2.
 *
 * Fires every Monday at 08:00 UTC. Fetches all orgs, iterates sequentially,
 * delegates to DigestService.buildAndSend. Errors per org are caught and
 * logged — one org failure never aborts the entire run.
 *
 * `runDigest(now?)` is public for testability (mirrors ScanSchedulerService
 * pattern in apps/scanner).
 *
 * Foot-gun #667: inject PrismaClient via @Inject(PRISMA_CLIENT).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { PrismaClient } from '@regwatch/db/client';
import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';
import { DigestService } from './digest.service.js';

@Injectable()
export class DigestSchedulerService {
  private readonly logger = new Logger(DigestSchedulerService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly digestService: DigestService,
  ) {}

  @Cron('0 8 * * 1', { name: 'digest-weekly', timeZone: 'UTC' })
  async handleCron(): Promise<void> {
    await this.runDigest(new Date());
  }

  /** Externalized for testability. */
  async runDigest(now: Date): Promise<void> {
    this.logger.log(`[digest] weekly run starting at ${now.toISOString()}`);

    const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const orgs = await this.prisma.organization.findMany({
      select: { id: true, name: true },
    });

    this.logger.log(`[digest] processing ${orgs.length} orgs`);

    for (const org of orgs) {
      try {
        await this.digestService.buildAndSend(org.id, org.name, windowStart, now);
      } catch (err) {
        this.logger.error(`[digest] unhandled error for org=${org.id}: ${String(err)}`);
      }
    }

    this.logger.log(`[digest] weekly run complete`);
  }
}
