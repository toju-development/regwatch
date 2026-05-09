-- MVP-14: Segmented Distribution (sdd/segmented-distribution)
--
-- 1. Add `jurisdictions TEXT[] NOT NULL DEFAULT '{}'` to NotificationChannel.
--    Existing rows become catch-all (empty array = receives all alerts).
-- 2. Drop the unique index that prevented multiple channels per org/provider.
-- 3. Add a regular index on (organizationId, provider) to preserve query performance.

-- AlterTable
ALTER TABLE "NotificationChannel" ADD COLUMN "jurisdictions" TEXT[] NOT NULL DEFAULT '{}';

-- DropIndex
DROP INDEX "NotificationChannel_organizationId_provider_key";

-- CreateIndex
CREATE INDEX "NotificationChannel_organizationId_provider_idx" ON "NotificationChannel"("organizationId", "provider");
