# RegWatch

[![CI](https://github.com/toju-development/regwatch/actions/workflows/ci.yml/badge.svg)](https://github.com/toju-development/regwatch/actions/workflows/ci.yml)

Regulatory-watch monorepo. Four apps (Next.js web + landing, NestJS api + scanner) and three shared packages (`@regwatch/db`, `@regwatch/types`, `@regwatch/config`) wired through pnpm + Turbo.

> Status: **MVP-1 bootstrap** — empty business logic, healthchecks only. See `.docs/initial-scope.md` and `.docs/roadmap.md`.

---

## Prerequisites

| Tool   | Version                  | Why                                              |
| ------ | ------------------------ | ------------------------------------------------ |
| Node   | `22.11.0` (see `.nvmrc`) | runtime for all apps                             |
| pnpm   | `9.15.0`                 | workspace package manager (managed via corepack) |
| Docker | any modern               | local Postgres for `@regwatch/db`                |

Enable corepack so the right pnpm version is auto-selected:

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
```

---

## Quickstart

```bash
# 1. install deps (postinstall runs `prisma generate` automatically)
pnpm install

# 2. start local Postgres (only needed when you actually touch the DB)
docker compose up -d

# 3. boot all four apps in parallel via Turbo
pnpm dev
```

`pnpm dev` runs every app's dev server in one terminal (Turbo TUI, single Ctrl-C tears them all down).

### Service ports & healthchecks

| App            | Stack                            | URL                   | Healthcheck       |
| -------------- | -------------------------------- | --------------------- | ----------------- |
| `apps/web`     | Next.js 15 + Tailwind 4 + shadcn | http://localhost:3000 | `GET /api/health` |
| `apps/api`     | NestJS 11                        | http://localhost:3001 | `GET /health`     |
| `apps/scanner` | NestJS 11                        | http://localhost:3002 | `GET /health`     |
| `apps/landing` | Next.js 15 (no DB, no shadcn)    | http://localhost:3003 | `GET /api/health` |

All four return `{ status, service, uptime, version }`.

```bash
curl http://localhost:3000/api/health
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3003/api/health
```

---

## Quality gates

The same four commands run locally and in CI (`.github/workflows/ci.yml`):

```bash
pnpm lint        # ESLint flat config + Prettier (per-app overrides)
pnpm typecheck   # tsc --noEmit per workspace
pnpm test        # Vitest, all 7 workspaces
pnpm build       # Next build + Nest build for all 4 apps
pnpm test:e2e    # Playwright (apps/web only) — requires `pnpm dev` reachable
```

All five must exit 0 before a PR can merge.

### Git hooks

Husky 9 wires two hooks on `pnpm install`:

- **pre-commit** → `lint-staged` (ESLint --fix + Prettier on staged files)
- **commit-msg** → `commitlint` with `@commitlint/config-conventional`

Non-conventional commit messages are rejected:

```bash
$ git commit -m "fixed stuff"
✖ subject may not be empty [subject-empty]
✖ type may not be empty   [type-empty]
husky - commit-msg script failed (code 1)
```

In CI (`CI=true`) the `prepare` script no-ops automatically — no git hooks are wired on the runner.

---

## Monorepo layout

```
regwatch/
├── apps/
│   ├── api/          NestJS 11 — port 3001
│   ├── scanner/      NestJS 11 — port 3002
│   ├── web/          Next.js 15 + Tailwind 4 + shadcn — port 3000
│   └── landing/      Next.js 15 (isolated, no DB) — port 3003
├── packages/
│   ├── db/           Prisma 6 client (`@regwatch/db`, server-only)
│   ├── types/        shared TS types (`@regwatch/types`)
│   └── config/       zod + t3-env composers (`@regwatch/config`)
├── .github/workflows/ci.yml
├── docker-compose.yml          (Postgres 16 for local dev)
├── turbo.json                  (build · dev · lint · typecheck · test graph)
├── pnpm-workspace.yaml
└── .docs/                      (scope, roadmap, SDD context)
```

### Package boundaries

- `apps/landing` MUST NOT import `@regwatch/db` or any shadcn primitives. Enforced via `eslint-plugin-no-restricted-imports`.
- `apps/web` does NOT import `@regwatch/db` directly — DB access is mediated through `apps/api`. Triple defence: no import + `import 'server-only'` in `packages/db/src/client.ts` + `serverExternalPackages` in `next.config.mjs`.
- `packages/*` are published as **source** (no per-package build step). Consumers compile via their own toolchain (Next SWC / Nest tsc / vitest).

---

## Database workflow

```bash
# generate the Prisma client (also runs on `pnpm install` via postinstall)
pnpm db:generate

# run a migration locally (dev mode — interactive)
pnpm -F @regwatch/db prisma migrate dev --name <change-name>

# apply migrations (CI / production — non-interactive)
pnpm -F @regwatch/db prisma migrate deploy
```

The Prisma client is generated to `packages/db/src/generated/client/` (gitignored) and re-exported from `@regwatch/db`.

---

## SDD (Spec-Driven Development)

This project uses an **engram-backed SDD workflow**. Specs, designs, tasks and apply-progress for each change live in persistent memory under topic keys like:

```
sdd/<change-name>/proposal
sdd/<change-name>/spec
sdd/<change-name>/design
sdd/<change-name>/tasks
sdd/<change-name>/apply-progress
```

Source-of-truth prose for the project itself lives in [`.docs/`](./.docs):

- [`.docs/initial-scope.md`](./.docs/initial-scope.md) — product scope, MVP slices
- [`.docs/roadmap.md`](./.docs/roadmap.md) — phase-by-phase delivery plan

---

## Troubleshooting

| Symptom                                | Fix                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `prisma generate` fails on fresh clone | run `pnpm install` again — `postinstall` triggers it                            |
| `EADDRINUSE` on `pnpm dev`             | another process is on 3000–3003; `lsof -i :3000`                                |
| Husky hooks not firing                 | `rm -rf .husky/_ && pnpm install` (re-runs `prepare`)                           |
| Playwright browser missing             | `pnpm -F @regwatch/web exec playwright install --with-deps chromium`            |
| `DATABASE_URL` unset                   | `cp packages/db/.env.example packages/db/.env` and start `docker compose up -d` |
