-- Migration #16: add_subscription (sdd/billing-stripe POST-9)
-- Pure-additive: CREATE TABLE + unique indexes.
-- No existing columns modified. Zero downtime.
-- Missing Subscription row = Free plan (INV-BILLING-1).

CREATE TABLE "Subscription" (
    "id"                   TEXT NOT NULL,
    "organizationId"       TEXT NOT NULL,
    "stripeCustomerId"     TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "stripePriceId"        TEXT NOT NULL,
    "status"               TEXT NOT NULL,
    "currentPeriodEnd"     TIMESTAMP(3) NOT NULL,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");
CREATE UNIQUE INDEX "Subscription_stripeCustomerId_key" ON "Subscription"("stripeCustomerId");
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- Index for customer-id lookups (webhook processing)
CREATE INDEX "Subscription_stripeCustomerId_idx" ON "Subscription"("stripeCustomerId");

-- FK: Subscription → Organization (CASCADE delete)
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
