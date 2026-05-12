/**
 * NotificationsModule — wires the notifications feature (Slack + Teams + Email).
 *
 * sdd/notify-slack/design D1: standalone module, AlertsModule untouched.
 * sdd/notify-teams (POST-1): adds TeamsAdapter + NotificationAdapterRegistry.
 * sdd/notify-email-resend (POST-2): adds ResendEmailNotificationAdapter under
 *   RESEND_EMAIL_NOTIFICATION_ADAPTER_TOKEN; passes to registry constructor.
 *
 * Providers:
 *  - NOTIFICATIONS_PRISMA_TOKEN                   → global PrismaClient (useExisting PRISMA_CLIENT)
 *  - NOTIFICATION_PORT_TOKEN (deprecated)          → SlackAdapter (useClass) — kept for backward compat
 *  - SLACK_ADAPTER_TOKEN                           → SlackAdapter (useClass)
 *  - TEAMS_ADAPTER_TOKEN                           → TeamsAdapter (useClass)
 *  - RESEND_EMAIL_NOTIFICATION_ADAPTER_TOKEN       → ResendEmailNotificationAdapter (useClass)
 *  - NOTIFICATION_ADAPTER_REGISTRY_TOKEN           → NotificationAdapterRegistry (useClass)
 *  - NOTIFICATIONS_REPO_TOKEN                      → NotificationsRepo (useClass)
 *  - NotificationsListenerService (singleton, registers @OnEvent handlers)
 *  - NotificationsService (channel CRUD orchestration)
 *
 * EventEmitter2 and PrismaModule are already global via AppModule.
 * EmailModule is @Global() — EMAIL_PORT resolves without an explicit import.
 *
 * Foot-gun #667: all providers use explicit Symbol/string token injection.
 */

import { Module } from '@nestjs/common';
import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';
import {
  NOTIFICATIONS_PRISMA_TOKEN,
  NOTIFICATION_PORT_TOKEN,
  NOTIFICATIONS_REPO_TOKEN,
  SLACK_ADAPTER_TOKEN,
  TEAMS_ADAPTER_TOKEN,
  NOTIFICATION_ADAPTER_REGISTRY_TOKEN,
  RESEND_EMAIL_NOTIFICATION_ADAPTER_TOKEN,
} from './tokens.js';
import { NotificationsListenerService } from './notifications.listener.service.js';
import { NotificationsRepo } from './notifications.repository.js';
import { SlackAdapter } from './adapters/slack.adapter.js';
import { TeamsAdapter } from './adapters/teams.adapter.js';
import { ResendEmailNotificationAdapter } from './adapters/resend-email-notification.adapter.js';
import { NotificationAdapterRegistry } from './notification-adapter.registry.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsController } from './notifications.controller.js';

@Module({
  controllers: [NotificationsController],
  providers: [
    {
      provide: NOTIFICATIONS_PRISMA_TOKEN,
      useExisting: PRISMA_CLIENT,
    },
    /** @deprecated — kept for backward compat; new code should use SLACK_ADAPTER_TOKEN */
    {
      provide: NOTIFICATION_PORT_TOKEN,
      useClass: SlackAdapter,
    },
    {
      provide: SLACK_ADAPTER_TOKEN,
      useClass: SlackAdapter,
    },
    {
      provide: TEAMS_ADAPTER_TOKEN,
      useClass: TeamsAdapter,
    },
    {
      provide: RESEND_EMAIL_NOTIFICATION_ADAPTER_TOKEN,
      useClass: ResendEmailNotificationAdapter,
    },
    {
      provide: NOTIFICATION_ADAPTER_REGISTRY_TOKEN,
      useClass: NotificationAdapterRegistry,
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
