/**
 * Shared billing types for the billing-stripe feature (sdd/billing-stripe POST-9).
 *
 * Consumed by:
 *   - `apps/api` — BillingService / BillingController / PlanGuard
 *   - `apps/web` — billing page, Server Actions
 *
 * Free-plan limits are defined here as the single source of truth
 * (INV-BILLING-1 / design §Interfaces).
 */

/** Which pricing tier an org is on. */
export type PlanTier = 'free' | 'pro';

/**
 * Mirrors Stripe subscription statuses.
 * `active` and `trialing` are the "passing" statuses for PlanGuard.
 */
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'unpaid';

/**
 * Read-model returned by `GET /org/:orgId/billing/status`.
 * `currentPeriodEnd` is ISO-8601.
 */
export interface SubscriptionDto {
  orgId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: string;
  stripePriceId: string;
}

/**
 * Free-plan hard limits — single source of truth used by `PlanGuard`.
 *
 * Design: `sdd/billing-stripe/design` §Interfaces/Contracts.
 */
export const FREE_PLAN_LIMITS = {
  alertsPerMonth: 10,
  members: 1,
} as const;
