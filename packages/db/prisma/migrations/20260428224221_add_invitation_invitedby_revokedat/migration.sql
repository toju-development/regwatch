-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "invitedById" TEXT,
ADD COLUMN     "revokedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- MANUAL APPEND (sdd/org-invitations D1, foot-gun #645): Postgres partial
-- unique index — defense-in-depth for the single-PENDING-per-(org,email)
-- invariant. App-layer REPLACE branch in InvitationsService.issue is the
-- user-facing path; this index catches concurrent races (P2002 fallback).
-- Permits historical REVOKED/ACCEPTED rows to coexist with a new PENDING.
-- Email is lowercased at write-time by application; lower() in the index
-- guards against any future drift. Prisma cannot model partial-where
-- uniques in schema — see packages/db/MIGRATION.md before modifying.
CREATE UNIQUE INDEX "invitation_pending_org_email_uq"
  ON "Invitation" ("organizationId", lower("email"))
  WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;
