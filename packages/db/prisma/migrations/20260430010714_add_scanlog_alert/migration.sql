-- CreateEnum
CREATE TYPE "AlertSource" AS ENUM ('BCRA_COMUNICADOS_A', 'BCRA_COMUNICADOS_B', 'BCRA_COMUNICADOS_C', 'CNV_RESOLUCIONES_GENERALES');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('UNKNOWN', 'INFO', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED_CAP_EXCEEDED');

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" "AlertSource" NOT NULL,
    "sourceUrl" VARCHAR(2048) NOT NULL,
    "sourceUrlHash" VARCHAR(64) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "summary" TEXT,
    "fullContent" TEXT,
    "publishedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "severity" "Severity" NOT NULL DEFAULT 'UNKNOWN',
    "regulationId" TEXT,
    "scanLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jurisdiction" VARCHAR(8) NOT NULL,
    "sourceUrl" VARCHAR(2048),
    "status" "ScanStatus" NOT NULL,
    "errorMsg" TEXT,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "alertsFound" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ScanLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Alert_organizationId_detectedAt_idx" ON "Alert"("organizationId", "detectedAt");

-- CreateIndex
CREATE INDEX "Alert_organizationId_source_idx" ON "Alert"("organizationId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_organizationId_sourceUrlHash_key" ON "Alert"("organizationId", "sourceUrlHash");

-- CreateIndex
CREATE INDEX "ScanLog_organizationId_startedAt_idx" ON "ScanLog"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "ScanLog_organizationId_status_idx" ON "ScanLog"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_scanLogId_fkey" FOREIGN KEY ("scanLogId") REFERENCES "ScanLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanLog" ADD CONSTRAINT "ScanLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
