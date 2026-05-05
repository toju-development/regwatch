-- Migration #9: MVP-6 alert-enrichment schema
-- sdd/classifier-and-writer/spec R-AlertEnrichment-Schema
-- Purely additive (new columns nullable, new enums, new table).
-- Severity enum reshaped: INFO removed, LOW + CRITICAL added (5-bucket).
-- Alert table confirmed empty before apply (no data backfill needed).

-- CreateEnum
CREATE TYPE "AlertTopic" AS ENUM ('FX', 'AML', 'KYC_ONBOARDING', 'CAPITAL_REQUIREMENTS', 'OPERATIONAL_RISK', 'CYBERSECURITY', 'REPORTING', 'CAPITAL_MARKETS', 'E_MONEY', 'ACQUIRING', 'REMITTANCES', 'BILL_PAYMENTS', 'QR_PAYMENTS', 'VIRTUAL_ASSETS', 'LENDING_CREDIT', 'OPEN_FINANCE', 'CONSUMER_PROTECTION', 'INSURANCE', 'DATA_PROTECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "EnrichmentStatus" AS ENUM ('PENDING', 'CLASSIFIED', 'WRITTEN', 'COMPLETED', 'CLASSIFY_FAILED', 'WRITE_FAILED', 'SKIPPED_CAP_EXCEEDED', 'SKIPPED_IRRELEVANT');

-- AlterEnum: reshape Severity from 4-bucket to 5-bucket (drop INFO, add LOW + CRITICAL)
BEGIN;
CREATE TYPE "Severity_new" AS ENUM ('UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
ALTER TABLE "public"."Alert" ALTER COLUMN "severity" DROP DEFAULT;
ALTER TABLE "Alert" ALTER COLUMN "severity" TYPE "Severity_new" USING ("severity"::text::"Severity_new");
ALTER TYPE "Severity" RENAME TO "Severity_old";
ALTER TYPE "Severity_new" RENAME TO "Severity";
DROP TYPE "public"."Severity_old";
ALTER TABLE "Alert" ALTER COLUMN "severity" SET DEFAULT 'UNKNOWN';
COMMIT;

-- AlterTable: add enrichment columns to Alert (all nullable — additive)
ALTER TABLE "Alert" ADD COLUMN     "citations" JSONB,
ADD COLUMN     "classifiedAt" TIMESTAMP(3),
ADD COLUMN     "enrichmentError" TEXT,
ADD COLUMN     "enrichmentStatus" "EnrichmentStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "executiveSummary" TEXT,
ADD COLUMN     "relevanceScore" INTEGER DEFAULT 0,
ADD COLUMN     "relevant" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "topic" "AlertTopic",
ADD COLUMN     "whatChangesForYou" TEXT,
ADD COLUMN     "writtenAt" TIMESTAMP(3);

-- AlterTable: add outputLanguage to Settings
ALTER TABLE "Settings" ADD COLUMN     "outputLanguage" TEXT;

-- CreateTable: EnrichmentLog
CREATE TABLE "EnrichmentLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "agent" VARCHAR(20) NOT NULL,
    "tokensInput" INTEGER NOT NULL DEFAULT 0,
    "tokensOutput" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "status" "EnrichmentStatus" NOT NULL,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnrichmentLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnrichmentLog_organizationId_createdAt_idx" ON "EnrichmentLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "EnrichmentLog_alertId_idx" ON "EnrichmentLog"("alertId");

-- CreateIndex
CREATE INDEX "Alert_organizationId_enrichmentStatus_idx" ON "Alert"("organizationId", "enrichmentStatus");

-- AddForeignKey
ALTER TABLE "EnrichmentLog" ADD CONSTRAINT "EnrichmentLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrichmentLog" ADD CONSTRAINT "EnrichmentLog_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
