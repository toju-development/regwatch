/**
 * BillingService — Stripe SDK calls + DB upsert logic.
 *
 * sdd/billing-stripe POST-9 — Task 2.2.
 *
 * Responsibilities:
 *   - `createCheckoutSession(orgId, successUrl, cancelUrl)` — creates a
 *     Stripe Checkout session for the Pro plan and returns the hosted URL.
 *   - `upsertSubscription(event)` — idempotent upsert keyed on
 *     `stripeSubscriptionId`; handles all 3 webhook event shapes.
 *   - `findByOrgId(orgId)` — reads the current Subscription row for the org.
 *
 * Foot-gun #667: explicit @Inject(TOKEN) for all constructor params.
 * Missing Subscription row = Free plan (INV-BILLING-1) — never throws.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type Stripe from 'stripe';
import type { PrismaClient } from '@regwatch/db';
import type { ApiEnv } from '@regwatch/config';
import { STRIPE_CLIENT_TOKEN, BILLING_PRISMA_TOKEN, BILLING_ENV_TOKEN } from './tokens.js';

export interface SubscriptionRow {
  id: string;
  organizationId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  status: string;
  currentPeriodEnd: Date;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(STRIPE_CLIENT_TOKEN) private readonly stripe: Stripe,
    @Inject(BILLING_PRISMA_TOKEN) private readonly prisma: PrismaClient,
    @Inject(BILLING_ENV_TOKEN) private readonly env: ApiEnv,
  ) {}

  /**
   * Creates a Stripe Checkout session for the Pro plan.
   * Returns the hosted Checkout URL.
   */
  async createCheckoutSession(
    orgId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ url: string }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: this.env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { organizationId: orgId },
    });

    if (!session.url) {
      throw new Error('Stripe Checkout session URL is null');
    }

    return { url: session.url };
  }

  /**
   * Upserts a Subscription row based on a Stripe subscription object.
   * Idempotent — keyed on `stripeSubscriptionId`.
   */
  async upsertSubscription(subscription: Stripe.Subscription, orgId: string): Promise<void> {
    const priceId = subscription.items.data[0]?.price.id ?? '';
    // `current_period_end` was removed in Stripe API 2026-04-22.dahlia.
    // Fall back to `billing_cycle_anchor` (same semantics for our purposes).
    const rawEnd =
      (subscription as unknown as { current_period_end?: number }).current_period_end ??
      subscription.billing_cycle_anchor;
    const currentPeriodEnd = new Date(rawEnd * 1000);

    await this.prisma.subscription.upsert({
      where: { stripeSubscriptionId: subscription.id },
      create: {
        organizationId: orgId,
        stripeCustomerId: String(subscription.customer),
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        status: subscription.status,
        currentPeriodEnd,
      },
      update: {
        stripePriceId: priceId,
        status: subscription.status,
        currentPeriodEnd,
      },
    });
  }

  /**
   * Finds the Subscription for a given org.
   * Returns null if org has no subscription (= Free plan).
   */
  async findByOrgId(orgId: string): Promise<SubscriptionRow | null> {
    return this.prisma.subscription.findUnique({
      where: { organizationId: orgId },
    });
  }

  /**
   * Finds the Subscription by Stripe customer ID.
   * Used in webhook processing when orgId must be resolved from customerId.
   */
  async findByStripeCustomerId(customerId: string): Promise<SubscriptionRow | null> {
    return this.prisma.subscription.findUnique({
      where: { stripeCustomerId: customerId },
    });
  }

  /**
   * Looks up orgId from a Stripe Checkout session.
   * Falls back to metadata.organizationId or the customer's existing sub.
   */
  async resolveOrgIdFromSession(session: Stripe.Checkout.Session): Promise<string | null> {
    // Prefer metadata set at session creation
    const fromMeta = session.metadata?.organizationId;
    if (fromMeta) return fromMeta;

    // Fall back to existing subscription via customer ID
    if (session.customer && typeof session.customer === 'string') {
      const existing = await this.findByStripeCustomerId(session.customer);
      if (existing) return existing.organizationId;
    }

    this.logger.warn(`Cannot resolve orgId from checkout session ${session.id}`);
    return null;
  }
}
