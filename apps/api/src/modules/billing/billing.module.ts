/**
 * BillingModule — wires the Stripe billing feature.
 *
 * sdd/billing-stripe POST-9 — Task 2.5.
 *
 * Provides:
 *   - `STRIPE_CLIENT_TOKEN` → Stripe SDK client instance
 *   - `BILLING_PRISMA_TOKEN` → global PrismaClient singleton
 *   - `BILLING_ENV_TOKEN` → validated API env slice
 *   - `BillingService` — Stripe SDK calls + DB upsert logic
 *   - `BillingController` — HTTP endpoints
 *
 * `PrismaModule` is `@Global()` so `PRISMA_CLIENT` is available without
 * an explicit import. We re-provide it under our own token so
 * `BillingService` stays decoupled from the global token and testable.
 *
 * Foot-gun #667: all providers use explicit token injection.
 */

import { Module } from '@nestjs/common';
import Stripe from 'stripe';
import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { BILLING_ENV_TOKEN, BILLING_PRISMA_TOKEN, STRIPE_CLIENT_TOKEN } from './tokens.js';
import { env } from '../../env.js';

@Module({
  controllers: [BillingController],
  providers: [
    {
      provide: BILLING_PRISMA_TOKEN,
      useExisting: PRISMA_CLIENT,
    },
    {
      provide: BILLING_ENV_TOKEN,
      useValue: env,
    },
    {
      provide: STRIPE_CLIENT_TOKEN,
      useValue: new Stripe(env.STRIPE_SECRET_KEY, {
        apiVersion: '2026-04-22.dahlia',
      }),
    },
    BillingService,
  ],
  exports: [BillingService],
})
export class BillingModule {}
