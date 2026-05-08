/**
 * NotificationsModule — wires the Slack notifications feature.
 *
 * sdd/notify-slack/design D1: standalone module, AlertsModule untouched.
 * sdd/notify-slack/design D4: native fetch, no Slack SDK.
 *
 * Providers:
 *  - NOTIFICATIONS_PRISMA_TOKEN → global PrismaClient (useExisting PRISMA_CLIENT)
 *  - NOTIFICATION_PORT_TOKEN    → SlackAdapter (useClass)
 *  - NOTIFICATIONS_REPO_TOKEN   → NotificationsRepo (useClass)
 *  - NotificationsListenerService (singleton, registers @OnEvent handlers)
 *  - NotificationsService (channel CRUD orchestration)
 *
 * EventEmitter2 and PrismaModule are already global via AppModule.
 *
 * Foot-gun #667: all providers use explicit Symbol token injection.
 */

import { Module } from '@nestjs/common';
import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';
import {
  NOTIFICATIONS_PRISMA_TOKEN,
  NOTIFICATION_PORT_TOKEN,
  NOTIFICATIONS_REPO_TOKEN,
} from './tokens.js';
import { NotificationsListenerService } from './notifications.listener.service.js';
import { NotificationsRepo } from './notifications.repository.js';
import { SlackAdapter } from './adapters/slack.adapter.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsController } from './notifications.controller.js';

@Module({
  controllers: [NotificationsController],
  providers: [
    {
      provide: NOTIFICATIONS_PRISMA_TOKEN,
      useExisting: PRISMA_CLIENT,
    },
    {
      provide: NOTIFICATION_PORT_TOKEN,
      useClass: SlackAdapter,
    },
    {
      provide: NOTIFICATIONS_REPO_TOKEN,
      useClass: NotificationsRepo,
    },
    NotificationsListenerService,
    NotificationsService,
  ],
})
export class NotificationsModule {}
