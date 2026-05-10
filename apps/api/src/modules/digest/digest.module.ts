/**
 * DigestModule — weekly digest email feature.
 *
 * sdd/digest-export (POST-3) — task 6.1.
 *
 * PrismaModule, EmailModule, and MembersModule are @Global() — no explicit
 * imports needed. ScheduleModule.forRoot() is wired in AppModule.
 *
 * Providers:
 *  - DIGEST_REPO_TOKEN → PrismaDigestRepository
 *  - DigestService
 *  - DigestSchedulerService
 */

import { Module } from '@nestjs/common';
import { DIGEST_REPO_TOKEN, PrismaDigestRepository } from './digest.repository.js';
import { DigestService } from './digest.service.js';
import { DigestSchedulerService } from './digest.scheduler.service.js';

@Module({
  providers: [
    { provide: DIGEST_REPO_TOKEN, useClass: PrismaDigestRepository },
    DigestService,
    DigestSchedulerService,
  ],
})
export class DigestModule {}
