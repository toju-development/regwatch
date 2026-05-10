/**
 * EmailInboundModule — wires the SendGrid Inbound Parse webhook feature.
 *
 * sdd/email-inbound MVP-15.
 *
 * Provides:
 *   - `EMAIL_INBOUND_PRISMA_TOKEN` → global `PrismaClient` singleton from `PrismaModule`.
 *   - `EMAIL_INBOUND_ENV_TOKEN` → the validated API env slice.
 *   - `EmailInboundService` — business logic.
 *   - `EmailInboundController` — HTTP controller.
 *
 * `PrismaModule` is `@Global()` so `PRISMA_CLIENT` is available without
 * an explicit import. We still re-provide it under our own token so
 * `EmailInboundService` stays decoupled from the global token and testable
 * in isolation.
 *
 * Foot-gun #667: all providers use explicit token injection.
 */
import { Module } from '@nestjs/common';
import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';
import { EmailInboundController } from './email-inbound.controller.js';
import { EmailInboundService } from './email-inbound.service.js';
import { EMAIL_INBOUND_PRISMA_TOKEN, EMAIL_INBOUND_ENV_TOKEN } from './tokens.js';
import { env } from '../../env.js';

@Module({
  controllers: [EmailInboundController],
  providers: [
    {
      provide: EMAIL_INBOUND_PRISMA_TOKEN,
      useExisting: PRISMA_CLIENT,
    },
    {
      provide: EMAIL_INBOUND_ENV_TOKEN,
      useValue: env,
    },
    EmailInboundService,
  ],
})
export class EmailInboundModule {}
