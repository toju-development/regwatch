-- Migration #11: MVP-7 manual-ingestion schema
-- sdd/manual-ingestion/spec R-SCHEMA-1, R-SCHEMA-2
-- Additive: new AlertSource enum value + nullable jurisdiction column on Alert.

-- AlterEnum: Add MANUAL to AlertSource.
-- NOTE: ALTER TYPE ... ADD VALUE must NOT be inside a transaction block in Postgres.
-- This file is executed outside a transaction by Prisma when migration.sql
-- contains no BEGIN/COMMIT wrapping this statement.
ALTER TYPE "AlertSource" ADD VALUE IF NOT EXISTS 'MANUAL';

-- AlterTable: add nullable jurisdiction column to Alert (R-SCHEMA-2, ADR-5)
-- Old rows: jurisdiction = NULL; EnrichmentService fallback covers scanner alerts.
ALTER TABLE "Alert" ADD COLUMN "jurisdiction" VARCHAR(8);
