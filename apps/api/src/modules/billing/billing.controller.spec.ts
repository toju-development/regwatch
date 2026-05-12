/**
 * Unit tests for `BillingController` webhook handler.
 *
 * sdd/billing-stripe POST-9 — Task 5.1.
 *
 * Tests:
 *   - Valid `checkout.session.completed` → 200 + upsert called
 *   - Valid `customer.subscription.updated` → 200 + upsert called
 *   - Valid `customer.subscription.deleted` → 200 + upsert with canceled
 *   - Invalid/missing Stripe-Signature header → 400
 *
 * No real Stripe API calls — `stripe.webhooks.constructEvent` is mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { STRIPE_CLIENT_TOKEN, BILLING_ENV_TOKEN } from './tokens.js';
import type { Request } from 'express';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeCheckoutSession(orgId: string) {
  return {
    id: 'cs_test_123',
    object: 'checkout.session',
    subscription: 'sub_test_123',
    customer: 'cus_test_123',
    metadata: { organizationId: orgId },
  };
}

function makeSubscription(status = 'active') {
  return {
    id: 'sub_test_123',
    object: 'subscription',
    customer: 'cus_test_123',
    status,
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
    items: { data: [{ price: { id: 'price_pro_123' } }] },
  };
}

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockUpsertSubscription = vi.fn().mockResolvedValue(undefined);
const mockFindByOrgId = vi.fn().mockResolvedValue(null);
const mockFindByStripeCustomerId = vi.fn().mockResolvedValue(null);
const mockResolveOrgIdFromSession = vi.fn().mockResolvedValue('org_test_123');
const mockCreateCheckoutSession = vi
  .fn()
  .mockResolvedValue({ url: 'https://checkout.stripe.com/test' });

const mockBillingService = {
  upsertSubscription: mockUpsertSubscription,
  findByOrgId: mockFindByOrgId,
  findByStripeCustomerId: mockFindByStripeCustomerId,
  resolveOrgIdFromSession: mockResolveOrgIdFromSession,
  createCheckoutSession: mockCreateCheckoutSession,
};

const mockConstructEvent = vi.fn();
const mockSubscriptionsRetrieve = vi.fn();

const mockStripe = {
  webhooks: {
    constructEvent: mockConstructEvent,
  },
  subscriptions: {
    retrieve: mockSubscriptionsRetrieve,
  },
};

const mockEnv = {
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_PRO_PRICE_ID: 'price_pro_123',
  APP_URL: 'http://localhost:3000',
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeRawBodyRequest(body: unknown): Request & { rawBody?: Buffer } {
  const raw = Buffer.from(JSON.stringify(body));
  return { rawBody: raw, protocol: 'http', get: () => 'localhost:3001' } as unknown as Request & {
    rawBody?: Buffer;
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('BillingController — webhook handler', () => {
  let controller: BillingController;

  beforeEach(async () => {
    vi.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        { provide: BillingService, useValue: mockBillingService },
        { provide: STRIPE_CLIENT_TOKEN, useValue: mockStripe },
        { provide: BILLING_ENV_TOKEN, useValue: mockEnv },
      ],
    }).compile();

    controller = moduleRef.get<BillingController>(BillingController);
  });

  it('handles checkout.session.completed with valid signature → 200', async () => {
    const session = makeCheckoutSession('org_test_123');
    const subscription = makeSubscription();

    mockConstructEvent.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: { object: session },
    });
    mockSubscriptionsRetrieve.mockResolvedValueOnce(subscription);

    const req = makeRawBodyRequest(session);
    const result = await controller.handleWebhook(req, 'stripe_sig_valid');

    expect(result).toEqual({ received: true });
    expect(mockConstructEvent).toHaveBeenCalledOnce();
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_test_123');
    expect(mockUpsertSubscription).toHaveBeenCalledWith(subscription, 'org_test_123');
  });

  it('handles customer.subscription.updated with valid signature → 200', async () => {
    const subscription = makeSubscription('active');
    const existingSub = { organizationId: 'org_test_123', stripeCustomerId: 'cus_test_123' };

    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: { object: subscription },
    });
    mockFindByStripeCustomerId.mockResolvedValueOnce(existingSub);

    const req = makeRawBodyRequest(subscription);
    const result = await controller.handleWebhook(req, 'stripe_sig_valid');

    expect(result).toEqual({ received: true });
    expect(mockUpsertSubscription).toHaveBeenCalledWith(subscription, 'org_test_123');
  });

  it('handles customer.subscription.deleted → status forced to canceled', async () => {
    const subscription = makeSubscription('canceled');
    const existingSub = { organizationId: 'org_test_123', stripeCustomerId: 'cus_test_123' };

    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.deleted',
      data: { object: subscription },
    });
    mockFindByStripeCustomerId.mockResolvedValueOnce(existingSub);

    const req = makeRawBodyRequest(subscription);
    const result = await controller.handleWebhook(req, 'stripe_sig_valid');

    expect(result).toEqual({ received: true });
    expect(mockUpsertSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'canceled' }),
      'org_test_123',
    );
  });

  it('throws BadRequestException on invalid Stripe signature', async () => {
    mockConstructEvent.mockImplementationOnce(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });

    const req = makeRawBodyRequest({});
    await expect(controller.handleWebhook(req, 'invalid_sig')).rejects.toThrow(BadRequestException);
  });

  it('throws ForbiddenException when Stripe-Signature header is missing', async () => {
    const req = makeRawBodyRequest({});
    await expect(controller.handleWebhook(req, undefined)).rejects.toThrow(ForbiddenException);
  });
});
