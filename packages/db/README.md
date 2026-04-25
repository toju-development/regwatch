# `@regwatch/db`

Identity baseline + Prisma client for RegWatch. Owns the `Organization`, `User`, `Membership`, `Invitation` and `Role` models, the singleton Prisma client (guarded by `server-only`), and small helpers like `generateInvitationToken()`. Every future scoped domain (alerts, audiences, scanners) hangs off this baseline by `organizationId`.

## Setup

A reachable Postgres 16 instance is required. Pick **one** path.

### Path A — docker-compose (default for new contributors)

From the repo root:

```bash
docker compose up -d postgres
```

Connection string for `packages/db/.env`:

```
DATABASE_URL=postgresql://regwatch:regwatch@localhost:5432/regwatch?schema=public
```

(Matches the credentials and DB name declared in `docker-compose.yml`.)

### Path B — native local Postgres (maintainer setup)

If you already run Postgres natively, create the dev database and use your local credentials, e.g.:

```
DATABASE_URL=postgresql://postgres:root@localhost:5432/regwatch_dev?schema=public
```

`packages/db/.env.example` ships a sane default. Copy it:

```bash
cp packages/db/.env.example packages/db/.env
```

> `packages/db/.env` is **gitignored** and required for any `prisma` command. Without it the Prisma CLI exits before reaching the DB.

## Prisma workflow

All commands run from the repo root (passthroughs are wired in the root `package.json`).

| Command                 | What it does                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm db:generate`      | Regenerate the Prisma client into `packages/db/src/generated/client/`.                           |
| `pnpm db:migrate`       | `prisma migrate dev` — apply pending migrations and prompt for a name when the schema drifts.    |
| `pnpm db:migrate:reset` | Drop and replay every migration; **does not** seed (`--skip-seed`). Use to validate cold replay. |
| `pnpm db:migrate:fresh` | Reset + run the dev seed. Everyday "blow it away and start over" command.                        |
| `pnpm db:seed`          | Run the idempotent dev seed. Aborts with a non-zero exit when `NODE_ENV=production`.             |

> **Footgun:** `pnpm --filter @regwatch/db prisma <cmd>` does **not** work — pnpm reports "no script named prisma". Always go through the `db:*` npm scripts above (or `pnpm --filter @regwatch/db exec prisma <cmd>` if you really need raw CLI access).

## Seed contents

`pnpm db:seed` upserts a deterministic dev fixture:

- **Organization** — `slug: regwatch-dev`, `name: Regwatch Dev`
- **User** — `email: dev@regwatch.local`, `name: Dev Owner`
- **Membership** — `OWNER` role linking the user to the org
- **Invitation** — `token: dev-invitation-token`, `role: ANALYST`, `expiresAt: now() + 7d`

Re-running is a no-op (all writes are `upsert` on stable keys). The token is a fixed string on purpose — it is a **dev fixture**, not a production pattern. Real entropy lands with the invitation creation flow in MVP-3.

## Adding a new migration

1. Edit `packages/db/prisma/schema.prisma`.
2. Run `pnpm db:migrate`. Prisma will prompt for a migration name (use snake_case, e.g. `add_alert_model`).
3. Commit both the schema change **and** the generated SQL file under `packages/db/prisma/migrations/<timestamp>_<name>/migration.sql`.
4. Re-run `pnpm db:migrate` once more — it must report "Already in sync" (deterministic).

## Production

- `prisma migrate deploy` is the production command, **not** `migrate dev`. CI already runs it on `main`.
- The seed script enforces `NODE_ENV !== 'production'` by hard-throwing at the top of `prisma/seed.ts`. This is **enforced**, not convention.

## Caveats

- **Prisma 7 deprecation**: we currently configure the seed via `package.json#prisma`. Prisma 7 will require `prisma.config.ts`. Tracked as a post-MVP-2 follow-up; non-blocking on 6.x.
- **ESM `.js` suffix**: every relative import in this package (`tokens.ts`, `seed.ts`, `index.ts`) uses the `.js` extension because the package is `"type": "module"` with NodeNext resolution. Bare-spec imports (`@prisma/client`, `crypto`) do not get the suffix. Don't drop it when adding new files.
- **`server-only` guard**: `src/client.ts` imports `server-only`. Importing `@regwatch/db` from a client component will fail the build by design.
- **Email casing**: normalize to lowercase **before** writing `User.email` / `Invitation.email`. The DB column stays `text` for portability; a future Citext migration is non-breaking.
