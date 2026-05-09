-- Migration #14: Add onboardingCompletedAt to Settings
-- Additive nullable column — no backfill (NULL is correct for all existing rows;
-- no real users exist pre-MVP-11). Fully reversible via the Down migration.

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);
