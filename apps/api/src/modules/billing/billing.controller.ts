/**
 * BillingController — Stripe webhook + checkout session endpoints.
 *
 * sdd/billing-stripe POST-9 — Task 2.4.
 *
 * Routes:
 *   POST /billing/webhook  — @Public(), raw body, Stripe sig verification.
 *   POST /billing/checkout — 4-guard chain, OWNER only, returns Checkout URL.
 *   GET  /billing/status   — 4-guard chain, OWNER+ADMIN, returns subscription DTO.
 *
 * Raw body: `rawBody: true` is already set in `apps/api/src/main.ts` (SendGrid
 * precedent). NestJS exposes the Buffer at `req.rawBody`.
 *
 * Foot-gun #667: explicit @Inject(BillingService).
 */

import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { Public } from '../../common/auth/public.decorator.js';
import { Roles } from '../../common/auth/decorators/roles.decorator.js';
import { CurrentOrg } from '../../common/auth/decorators/current-org.decorator.js';
import { BillingService } from './billing.service.js';
import { BILLING_ENV_TOKEN, STRIPE_CLIENT_TOKEN } from './tokens.js';
import type { ApiEnv } from '@regwatch/config';
import type { SubscriptionDto } from '@regwatch/types';

@Controller('billing')
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    @Inject(BillingService) private readonly billingService: BillingService,
    @Inject(STRIPE_CLIENT_TOKEN) private readonly stripe: Stripe,
    @Inject(BILLING_ENV_TOKEN) private readonly env: ApiEnv,
  ) {}

  /**
   * POST /billing/webhook
   *
   * Stripe webhook endpoint. @Public() — no JWT required.
   * Raw body is passed to `stripe.webhooks.constructEvent` for signature
   * verification. Handles 3 event types:
   *   - `checkout.session.completed`
   *   - `customer.subscription.updated`
   *   - `customer.subscription.deleted`
   */
  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: boolean }> {
    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error('rawBody is undefined — ensure rawBody: true in NestFactory.create');
      throw new BadRequestException('Raw body unavailable');
    }

    if (!signature) {
      throw new ForbiddenException('Missing Stripe-Signature header');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(`Stripe signature verification failed: ${msg}`);
      throw new BadRequestException(`Webhook signature verification failed: ${msg}`);
    }

    await this.handleEvent(event);
    return { received: true };
  }

  /**
   * POST /billing/checkout
   *
   * Creates a Stripe Checkout session for the Pro plan.
   * Protected by the full 4-guard chain; OWNER-only.
   * Returns `{ url }` pointing to the Stripe-hosted Checkout page.
   */
  @Post('checkout')
  @Roles('OWNER')
  @HttpCode(HttpStatus.CREATED)
  async createCheckoutSession(@CurrentOrg() orgId: string): Promise<{ url: string }> {
    const successUrl = `${this.env.APP_URL}/settings/billing?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${this.env.APP_URL}/settings/billing`;

    return this.billingService.createCheckoutSession(orgId, successUrl, cancelUrl);
  }

  /**
   * GET /billing/status
   *
   * Returns the current subscription record for the active org, or null.
   * OWNER + ADMIN can view.
   */
  @Get('status')
  @Roles('OWNER', 'ADMIN')
  async getBillingStatus(@CurrentOrg() orgId: string): Promise<SubscriptionDto | null> {
    const sub = await this.billingService.findByOrgId(orgId);
    if (!sub) return null;

    return {
      orgId: sub.organizationId,
      status: sub.status as SubscriptionDto['status'],
      currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
      stripePriceId: sub.stripePriceId,
    };
  }

  // ─── private helpers ──────────────────────────────────────────────────────

  private async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await this.handleCheckoutSessionCompleted(session);
        break;
      }
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionUpdated(subscription);
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionDeleted(subscription);
        break;
      }
      default:
        // Ignore unhandled event types
        this.logger.debug(`Unhandled Stripe event type: ${event.type}`);
    }
  }

  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const orgId = await this.billingService.resolveOrgIdFromSession(session);
    if (!orgId) {
      this.logger.error(
        `checkout.session.completed: could not resolve orgId from session ${session.id}`,
      );
      return;
    }

    // Expand the subscription from the session
    if (!session.subscription) {
      this.logger.warn(`checkout.session.completed: no subscription on session ${session.id}`);
      return;
    }

    const subscriptionId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription.id;

    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    await this.billingService.upsertSubscription(subscription, orgId);
    this.logger.log(`Subscription created/updated for org ${orgId}`);
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    // Resolve orgId from existing Subscription row
    const existing = await this.billingService.findByStripeCustomerId(
      String(subscription.customer),
    );
    if (!existing) {
      this.logger.warn(
        `customer.subscription.updated: no Subscription row for customer ${String(subscription.customer)}`,
      );
      return;
    }
    await this.billingService.upsertSubscription(subscription, existing.organizationId);
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const existing = await this.billingService.findByStripeCustomerId(
      String(subscription.customer),
    );
    if (!existing) {
      this.logger.warn(
        `customer.subscription.deleted: no Subscription row for customer ${String(subscription.customer)}`,
      );
      return;
    }
    // Force status = 'canceled' regardless of Stripe's emitted status
    const canceled: Stripe.Subscription = { ...subscription, status: 'canceled' };
    await this.billingService.upsertSubscription(canceled, existing.organizationId);
  }
}
