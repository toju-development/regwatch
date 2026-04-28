# `@regwatch/db` — Migration Conventions

> Source-of-truth for non-obvious migration mechanics in `packages/db/prisma/migrations/`.

## Manual SQL appends to generated migrations

Prisma's schema language CANNOT model every Postgres feature we rely on. When we need one of those features, the workflow is:

1. Edit `schema.prisma` for whatever Prisma CAN express.
2. `pnpm -F @regwatch/db exec prisma migrate dev --name <slug> --create-only` — generates `migration.sql` WITHOUT applying.
3. Manually APPEND the raw SQL at the bottom of the generated `migration.sql`.
4. Apply: `pnpm db:migrate`.
5. Verify the migration is cold-replayable: `pnpm db:migrate:fresh` (drops + reapplies all from scratch).
6. Document the manual append HERE so the next dev doesn't strip it.

**RULE**: Never edit a migration after it's been merged to `main`. Need a change? Write a NEW migration. Editing in-place breaks `prisma migrate deploy` for anyone whose DB has the old hash recorded in `_prisma_migrations`.

## Catalog of migrations with manual appends

### `20260428224221_add_invitation_invitedby_revokedat` — partial unique index

**Why manual**: Prisma's `@@unique` cannot express `WHERE` clauses (partial indexes). We need the constraint
`UNIQUE (organizationId, lower(email)) WHERE acceptedAt IS NULL AND revokedAt IS NULL`
to enforce the single-PENDING-per-(org, email) invariant at the DB layer (defense-in-depth for `sdd/org-invitations` foot-gun #645). Historical REVOKED/ACCEPTED rows must coexist with a new PENDING — a full `@@unique([organizationId, email])` would forbid that (R-Invitation-Schema scenario "partial unique index permits REVOKED + new PENDING coexistence").

**Manual SQL** (preserved at the bottom of that migration's `.sql`):

```sql
CREATE UNIQUE INDEX "invitation_pending_org_email_uq"
  ON "Invitation" ("organizationId", lower("email"))
  WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;
```

Service layer (`InvitationsService.issue`) ALSO implements an app-level REPLACE branch on existing PENDING rows. The DB index is the safety net for concurrent races (Prisma `P2002` → service catches and re-runs REPLACE).
