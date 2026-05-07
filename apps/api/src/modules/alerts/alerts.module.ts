/**
 * AlertsModule — wires the alert collaboration feature.
 *
 * sdd/alert-collaboration MVP-8.
 *
 * Mirrors IngestModule structure (design D6):
 *   - ALERTS_PRISMA_TOKEN → global PrismaClient singleton (useExisting PRISMA_CLIENT)
 *   - ALERTS_ENV_TOKEN → validated API env slice
 *   - AlertsRepo, AlertsService, AlertsController
 *
 * EventEmitter2 is already global via EventEmitterModule.forRoot() in AppModule.
 * PrismaModule is @Global() so PRISMA_CLIENT is available without explicit import.
 *
 * Foot-gun #667: all providers use explicit token injection.
 */

import { Module } from '@nestjs/common';
import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';
import { AlertsController } from './alerts.controller.js';
import { AlertsService } from './alerts.service.js';
import { AlertsRepo } from './alerts.repository.js';
import { ALERTS_ENV_TOKEN, ALERTS_PRISMA_TOKEN } from './tokens.js';
import { env } from '../../env.js';

@Module({
  controllers: [AlertsController],
  providers: [
    {
      provide: ALERTS_PRISMA_TOKEN,
      useExisting: PRISMA_CLIENT,
    },
    {
      provide: ALERTS_ENV_TOKEN,
      useValue: env,
    },
    {
      provide: 'ALERTS_REPO',
      useClass: AlertsRepo,
    },
    AlertsRepo,
    AlertsService,
  ],
  exports: [AlertsService],
})
export class AlertsModule {}
