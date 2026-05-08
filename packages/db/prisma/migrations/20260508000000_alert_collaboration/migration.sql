-- Migration #12: MVP-8 alert-collaboration schema
-- sdd/alert-collaboration/spec — db-schema domain (AlertStatus, AlertEventKind,
-- AlertComment, AlertEvent, Alert collaboration columns).
--
-- Fully transactional: all new types and tables use CREATE TYPE / CREATE TABLE.
-- No ALTER TYPE … ADD VALUE — safe within a BEGIN/COMMIT block.
-- Rollback: DROP TABLE "AlertComment","AlertEvent"; ALTER TABLE "Alert" DROP COLUMN
--   "status","assigneeId","conclusion","regulator"; DROP TYPE "AlertStatus","AlertEventKind".
-- Zero data-loss: existing Alert rows get status=NEW, assigneeId=NULL, conclusion=NULL,
-- regulator=NULL (additive defaults).

BEGIN;

-- Enums

CREATE TYPE "AlertStatus" AS ENUM (
  'NEW',
  'TRIAGING',
  'ANALYZING',
  'DEBATING',
  'CONCLUDED',
  'DISTRIBUTED',
  'ARCHIVED'
);

CREATE TYPE "AlertEventKind" AS ENUM (
  'STATUS_CHANGED',
  'ASSIGNED',
  'CONCLUSION_UPDATED',
  'COMMENT_ADDED'
);

-- Alert collaboration columns

ALTER TABLE "Alert"
  ADD COLUMN "status"     "AlertStatus" NOT NULL DEFAULT 'NEW',
  ADD COLUMN "assigneeId" TEXT,
  ADD COLUMN "conclusion" TEXT,
  ADD COLUMN "regulator"  VARCHAR(128);

ALTER TABLE "Alert"
  ADD CONSTRAINT "Alert_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AlertComment table

CREATE TABLE "AlertComment" (
  "id"             TEXT NOT NULL,
  "alertId"        TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "authorId"       TEXT NOT NULL,
  "body"           TEXT NOT NULL,
  "parentId"       TEXT,
  "editedAt"       TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AlertComment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AlertComment"
  ADD CONSTRAINT "AlertComment_alertId_fkey"
  FOREIGN KEY ("alertId") REFERENCES "Alert"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AlertComment"
  ADD CONSTRAINT "AlertComment_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AlertComment"
  ADD CONSTRAINT "AlertComment_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "AlertComment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AlertComment_alertId_createdAt_idx" ON "AlertComment"("alertId", "createdAt");
CREATE INDEX "AlertComment_organizationId_createdAt_idx" ON "AlertComment"("organizationId", "createdAt");

-- AlertEvent table

CREATE TABLE "AlertEvent" (
  "id"             TEXT NOT NULL,
  "alertId"        TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "actorId"        TEXT NOT NULL,
  "kind"           "AlertEventKind" NOT NULL,
  "fromStatus"     "AlertStatus",
  "toStatus"       "AlertStatus",
  "assigneeId"     TEXT,
  "note"           TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AlertEvent"
  ADD CONSTRAINT "AlertEvent_alertId_fkey"
  FOREIGN KEY ("alertId") REFERENCES "Alert"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AlertEvent"
  ADD CONSTRAINT "AlertEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "AlertEvent_alertId_createdAt_idx" ON "AlertEvent"("alertId", "createdAt");
CREATE INDEX "AlertEvent_organizationId_createdAt_idx" ON "AlertEvent"("organizationId", "createdAt");

COMMIT;
