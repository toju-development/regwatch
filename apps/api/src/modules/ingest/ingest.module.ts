/**
 * IngestModule — wires the manual ingestion feature.
 *
 * sdd/manual-ingestion B4.7.
 *
 * Provides:
 *   - `INGEST_PRISMA_TOKEN` → global `PrismaClient` singleton from `PrismaModule`.
 *   - `INGEST_ENV_TOKEN` → the validated API env slice.
 *   - `IngestService` — service class.
 *   - `IngestController` — HTTP controller.
 *
 * `PrismaModule` is `@Global()` so `PRISMA_CLIENT` is available without
 * an explicit import. We still re-provide it under our own token so
 * `IngestService` stays decoupled from the global token and testable
 * in isolation.
 *
 * Foot-gun #667: all providers use explicit token injection.
 */

import { Module } from '@nestjs/common';
import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';
import { IngestController } from './ingest.controller.js';
import { IngestService } from './ingest.service.js';
import { INGEST_ENV_TOKEN, INGEST_PRISMA_TOKEN } from './tokens.js';
import { PlanGuard } from '../../common/guards/plan.guard.js';
import { env } from '../../env.js';

@Module({
  controllers: [IngestController],
  providers: [
    {
      provide: INGEST_PRISMA_TOKEN,
      useExisting: PRISMA_CLIENT,
    },
    {
      provide: INGEST_ENV_TOKEN,
      useValue: env,
    },
    IngestService,
    PlanGuard,
  ],
})
export class IngestModule {}
