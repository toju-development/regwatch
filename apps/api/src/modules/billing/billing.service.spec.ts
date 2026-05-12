/**
 * Unit tests for `BillingService`.
 *
 * sdd/billing-stripe POST-9 — Task 5.2.
 *
 * Tests:
 *   - `upsertSubscription`: new record creation
 *   - `upsertSubscription`: update on repeat event
 *   - `upsertSubscription`: status forced to 'canceled' on deletion event
 *   - `findByOrgId`: existing subscription returned
 *   - `findByOrgId`: null when no subscription exists
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingService } from './billing.service.js';
import type Stripe from 'stripe';

// ─── Prisma mock ───────────────────────────────────────────────────────────

const mockUpsert = vi.fn().mockResolvedValue(undefined);
const mockFindUnique = vi.fn();

const mockPrisma = {
  subscription: {
    upsert: mockUpsert,
    findUnique: mockFindUnique,
  },
};

// ─── Stripe mock ───────────────────────────────────────────────────────────

const mockCheckoutSessionsCreate = vi.fn();

const mockStripe = {
  checkout: { sessions: { create: mockCheckoutSessionsCreate } },
  subscriptions: { retrieve: vi.fn() },
  webhooks: { constructEvent: vi.fn() },
} as unknown as Stripe;

// ─── Env mock ──────────────────────────────────────────────────────────────

const mockEnv = {
  STRIPE_PRO_PRICE_ID: 'price_pro_test',
  STRIPE_SECRET_KEY: 'sk_test',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  APP_URL: 'http://localhost:3000',
};

// ─── Fixture ───────────────────────────────────────────────────────────────

function makeSubscription(status = 'active', subscriptionId = 'sub_test_123'): Stripe.Subscription {
  return {
    id: subscriptionId,
    object: 'subscription',
    customer: 'cus_test_123',
    status,
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
    items: { data: [{ price: { id: 'price_pro_test' } }] },
  } as unknown as Stripe.Subscription;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('BillingService', () => {
  let service: BillingService;

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new BillingService(mockStripe, mockPrisma as any, mockEnv as any);
  });

  describe('upsertSubscription', () => {
    it('creates a new Subscription row when none exists', async () => {
      const sub = makeSubscription('active');
      await service.upsertSubscription(sub, 'org_123');

      expect(mockUpsert).toHaveBeenCalledOnce();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const call = (mockUpsert.mock.calls[0] as any[])[0];
      expect(call.where).toEqual({ stripeSubscriptionId: 'sub_test_123' });
      expect(call.create.organizationId).toBe('org_123');
      expect(call.create.status).toBe('active');
    });

    it('updates an existing row on repeat event (idempotent upsert)', async () => {
      const sub = makeSubscription('past_due');
      await service.upsertSubscription(sub, 'org_123');

      expect(mockUpsert).toHaveBeenCalledOnce();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const call = (mockUpsert.mock.calls[0] as any[])[0];
      expect(call.update.status).toBe('past_due');
    });

    it('sets status to canceled on subscription deleted event', async () => {
      const sub = makeSubscription('canceled');
      await service.upsertSubscription(sub, 'org_123');

      expect(mockUpsert).toHaveBeenCalledOnce();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const call = (mockUpsert.mock.calls[0] as any[])[0];
      expect(call.create.status).toBe('canceled');
      expect(call.update.status).toBe('canceled');
    });
  });

  describe('findByOrgId', () => {
    it('returns the Subscription row when one exists', async () => {
      const row = { id: 'sub_row_1', organizationId: 'org_123', status: 'active' };
      mockFindUnique.mockResolvedValueOnce(row);

      const result = await service.findByOrgId('org_123');

      expect(mockFindUnique).toHaveBeenCalledWith({ where: { organizationId: 'org_123' } });
      expect(result).toEqual(row);
    });

    it('returns null when no Subscription row exists (Free plan)', async () => {
      mockFindUnique.mockResolvedValueOnce(null);

      const result = await service.findByOrgId('org_no_sub');

      expect(result).toBeNull();
    });
  });
});
