-- CreateEnum
CREATE TYPE "NotificationProvider" AS ENUM ('SLACK');

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "NotificationProvider" NOT NULL,
    "webhookUrl" TEXT NOT NULL,
    "channelName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationChannel_organizationId_idx" ON "NotificationChannel"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationChannel_organizationId_provider_key" ON "NotificationChannel"("organizationId", "provider");

-- AddForeignKey
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
