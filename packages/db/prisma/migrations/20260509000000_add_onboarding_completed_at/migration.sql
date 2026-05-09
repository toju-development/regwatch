-- Migration #14: Add onboardingCompletedAt to Settings
-- Additive nullable column — no backfill (NULL is correct for all existing rows;
-- no real users exist pre-MVP-11). If rollback is needed, create a new migration
-- that drops the column.

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);
