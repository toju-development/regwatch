# RegWatch — Delivery Roadmap (v3)

> Decomposition of `.docs/initial-scope.md` into independently shippable vertical slices for SDD.
> Source of truth: `.docs/initial-scope.md` (v3) + engram `sdd-init/regwatch`.
> Persistence: engram `sdd/roadmap/explore`.

---

## Changelog

- **v3 — 2026-04-24**: `apps/landing` added as a fourth Next.js 15 app; **Organization-first multi-user model** formalized (Org as principal entity, multi-org membership, 4 roles `OWNER/ADMIN/ANALYST/VIEWER`, auto-org on signup, email invitations, `X-Org-Id` request scoping); `auth-multitenancy` split into `auth-foundation` (MVP-3a) + `organization-multitenancy` (MVP-3b); downstream slices re-scoped to `organizationId` invariant; new post-MVP slice `marketing-landing-content` (POST-N). Slice count: 22 → **24 named slices** (16 MVP + 8 POST, plus the multi-country POST-10 micro-slices).
- **v2 — 2026-04-24**: NestJS adoption (api + scanner), three-apps split from day 1, Next.js 15 + shadcn/ui + Tailwind 4, compliance workflow capabilities added (collaboration, manual ingestion, email inbound, segmented distribution), mapa LATAM en MVP, pnpm + Turbo confirmed, NextAuth (Google OAuth + magic link), Vitest + Playwright, ADK como librería dentro de `apps/scanner`.
- **v1 — 2026-04-24**: Initial 21-slice roadmap (Express, single API app, Next.js 14, map deferred to v2).

---

## Section 1 — Resolved Decisions

| Decision            | Resolution                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend framework   | ✅ **NestJS** (latest). Every backend slice uses the `nestjs-best-practices` skill.                                                                                                                                                                                                                                                                                           |
| App layout (day 1)  | ✅ **Four apps**: `apps/api` (REST + auth + dashboard backend), `apps/scanner` (workers + crons + ADK agents + inbound mail), `apps/web` (Next.js 15 product app), **`apps/landing`** (Next.js 15 marketing site).                                                                                                                                                            |
| Shared packages     | ✅ `packages/db` (Prisma + client), `packages/types` (shared DTOs/enums), `packages/config` (zod env).                                                                                                                                                                                                                                                                        |
| Cron strategy       | ✅ **`@nestjs/schedule`** inside `apps/scanner`.                                                                                                                                                                                                                                                                                                                              |
| ADK                 | ✅ Library inside `apps/scanner`, wrapped by a NestJS module.                                                                                                                                                                                                                                                                                                                 |
| Frontend framework  | ✅ **Next.js 15** (App Router) for both `apps/web` and `apps/landing`.                                                                                                                                                                                                                                                                                                        |
| UI system           | ✅ **shadcn/ui + Tailwind 4** (skill registry: `tailwind-4`).                                                                                                                                                                                                                                                                                                                 |
| Package manager     | ✅ **pnpm** + Turbo.                                                                                                                                                                                                                                                                                                                                                          |
| Test stack          | ✅ **Vitest** (unit/integration) + **Playwright** (E2E).                                                                                                                                                                                                                                                                                                                      |
| Auth                | ✅ **NextAuth**: Google OAuth + magic link. **Shared JWT** between API and Web (carries `userId` + memberships). MS Entra ID = future slice (post-MVP).                                                                                                                                                                                                                       |
| **Identity model**  | ✅ **Organization-first, multi-user, multi-org**. `Organization` is THE principal entity. A `User` can belong to N Organizations via `Membership`. Roles: **`OWNER / ADMIN / ANALYST / VIEWER`**. Personal Org auto-created on first signup. Invitations by email. JWT carries `{ userId, memberships: [{orgId, role}] }`. Every API request is scoped via `X-Org-Id` header. |
| **Landing app**     | ✅ Separate `apps/landing` (Next.js 15). Rationale: independent perf budget (no auth/SDK weight), distinct deploy cadence (marketing iterates faster than product), distinct domain (`regwatch.app` vs `app.regwatch.app`), SEO/edge optimization without leaking the product bundle.                                                                                         |
| Map (dashboard)     | ✅ **In MVP**. Library: `react-simple-maps` (lightweight, SVG, no token) — confirm vs MapLibre during dashboard slice.                                                                                                                                                                                                                                                        |
| Database            | ✅ Postgres + Prisma (schema in `packages/db`).                                                                                                                                                                                                                                                                                                                               |
| Multi-tenancy       | ✅ Mandatory `organizationId` scoping everywhere. `RolesGuard` + `@Roles()` decorator in NestJS. Dedup invariant: `(organizationId, sourceUrlHash)`.                                                                                                                                                                                                                          |
| Product positioning | ✅ RegWatch **augments** the law-firm channel; it does NOT replace it. Distribution UX must surface "this came from RegWatch" so it's complementary, not duplicate.                                                                                                                                                                                                           |
| Gemini cost ceiling | ⏳ **TBD** — must be resolved before `scanner-vertical-ar` (MVP-5).                                                                                                                                                                                                                                                                                                           |

---

## Section 2 — Capability Inventory

Grouped by domain. Each capability maps to one or more slices in Section 3.

### 1. Foundation / Tooling

- pnpm + Turbo monorepo
- **Four apps** from day 1: `apps/api`, `apps/scanner`, `apps/web`, **`apps/landing`**
- Shared packages: `packages/db`, `packages/types`, `packages/config`
- TypeScript strict, shared tsconfig, ESLint/Prettier
- Env validation (zod) in `packages/config`
- Local dev (Postgres via Docker compose), Prisma migrate workflow
- CI skeleton (typecheck + lint + Vitest)

### 2. Data Model & Persistence

- Prisma schema: **`Organization`** (principal entity), **`User`**, **`Membership`** (User↔Org join with `role`), **`Invitation`**, **`Role` enum** (`OWNER | ADMIN | ANALYST | VIEWER`), `Settings` (per Org), `Alert`, `Digest`, `ScanLog`, `AlertComment`, `AlertAttachment`, `AlertAudience`, `InboundMailbox`, `InboundMessage`, `AlertSource` enum (channel: `scanner | manual | email`)
- Migrations + seed (default jurisdictions config)
- Repository helpers with mandatory **`organizationId`** scoping
- Deduplication helper — invariant **`(organizationId, sourceUrlHash)`**

### 3. Auth & Multi-Tenancy

- NextAuth (Google OAuth + magic link via Resend) — slice MVP-3a
- Shared JWT verified by NestJS `JwtStrategy` (Passport) on `apps/api`
- **Auto-create personal Org on first signup** + auto-`Membership` with role `OWNER`
- **Multi-org membership**: a User can belong to N Orgs simultaneously
- **Roles**: `OWNER | ADMIN | ANALYST | VIEWER` enforced via `@Roles()` decorator + `RolesGuard`
- **JWT claims**: `{ userId, email, memberships: [{orgId, role}] }`
- **Request scoping**: `X-Org-Id` header (chosen over path prefix — keeps URLs stable, scoping is transport-level concern). Global `OrgScopeGuard` validates the header against JWT memberships and injects `organizationId` + `currentRole` into request scope.
- **Org switcher** UI component in `apps/web` (potential `⌘K` palette — see Open Decisions)
- Invite-by-email flow (`Invitation` table + `POST /api/org/:orgId/invitations`) — MVP-3b

### 4. Agent Pipeline (AI core, lives in `apps/scanner`)

- ADK TS 1.0 setup wrapped in a NestJS `AgentsModule`
- Root LlmAgent + per-jurisdiction Scanner agents (GOOGLE_SEARCH tool)
- `classifyTool` (severity + category)
- `deduplicationTool` (DB lookup by `(organizationId, sourceUrlHash)`)
- `storageTool` (persists `Alert` with `source: 'scanner'`, scoped to `organizationId`)
- `writerAgent` (Markdown digest)
- Per-org runtime injection of `customTopics`
- `jurisdictions.ts` registry — adding a country = one config entry

### 5. Scheduling (in `apps/scanner`)

- `@nestjs/schedule` per-org dynamic cron registry loaded from `Settings` (one cron per `organizationId`)
- Re-schedule on `Settings` update (cancel + recreate via shared event/queue)
- Manual trigger endpoint: `POST /api/scan` in `apps/api` enqueues a job (carries `organizationId`) consumed by `apps/scanner`
- `ScanLog` lifecycle: `running → completed | failed`

### 6. Manual Ingestion (compliance workflow)

- Paste URL → fetch + extract → create `Alert` (source: `manual`, scoped to `organizationId`)
- Upload PDF → parse text → create `Alert`
- Paste raw text → create `Alert`
- Reuses dedup, classifier, storage tools — **same pipeline as scanner, different source channel**

### 7. Email Inbound Ingestion

- Per-org mailbox: `alerts-{orgslug}@inbound.regwatch.app` (or forward-to address) — provisioned per `Organization`
- Provider: Postmark Inbound (recommended) or AWS SES → webhook into `apps/scanner`
- Parser extracts subject/body/attachments from incoming emails
- Emits one `Alert` per parsed novelty (source: `email`, `InboundMessage` linked, scoped to `organizationId`)
- Same dedup + classifier + storage path

### 8. Collaborative Analysis Workflow (per Alert)

- Status machine: `new → triaging → analyzing → debating → concluded → distributed`
- **Assignee** must be a `User` with active `Membership` in the Alert's `organizationId`
- Comments thread (`AlertComment` — scoped per Org; author must be a `Member`)
- Attachments (`AlertAttachment` — files uploaded by reviewers)
- Related-alerts linking (self-relation on `Alert`, same `organizationId`)
- Audit log of status transitions (records `userId` + `role` at time of action)

### 9. Segmented Distribution

- `AlertAudience` join table — audience members must be `User`s with active `Membership` in the same `organizationId`
- Audience templates: `team | c-level | legal | product | risk | custom`
- Per-audience routing config (Slack channels, distinct email lists, etc.)
- `notifyTool` refactored from single dispatcher into an **audience-aware router**

### 10. Notifications

- `notifyTool` dispatcher honoring per-audience routing + `minSeverityNotify`
- Slack incoming webhook (plain JSON message)
- Teams incoming webhook (Adaptive Card payload)
- Email via Resend (HTML digest, optional PDF)
- "Test notification" action from Settings

### 11. API Surface (NestJS, in `apps/api`)

- All endpoints scoped via `X-Org-Id` header → `OrgScopeGuard` injects `organizationId`
- All endpoints role-checked via `@Roles(...)` decorator
- `POST /api/scan` (manual trigger — enqueues to scanner)
- `POST /api/alerts/manual` (URL / PDF / text ingestion)
- `GET /api/alerts` (filterable: severity, jurisdiction, category, status, source, assignee, audience, date)
- `PATCH /api/alerts/:id` (status, assignee, audience set)
- `POST /api/alerts/:id/comments`
- `POST /api/alerts/:id/attachments`
- `GET /api/digests` + `GET /api/digests/:id`
- `GET/PUT /api/settings`
- `GET /api/scans` (history)
- `GET /api/org/me` (returns current user's memberships)
- `POST /api/org` (create new org — auto-makes caller `OWNER`)
- `POST /api/org/:orgId/invitations` (invite by email; `OWNER`/`ADMIN` only)
- `POST /api/invitations/:token/accept`
- `POST /webhooks/inbound-email` (consumed by scanner via internal call)

### 12. Web App (Next.js 15 App Router — `apps/web`)

- Auth/login pages (Google + magic link)
- **Org switcher** (header + `⌘K` palette TBD)
- Onboarding (3 steps + first-scan) — runs on the auto-created personal Org
- Dashboard (latest scan summary, severity chips, critical+high list, **LatAm activity map (MVP)**, recent digests)
- Alerts list (filters incl. source + assignee + audience)
- Alert detail page (status workflow, comments, attachments, audience selector, related links)
- Manual ingestion drawer (paste URL / drop PDF / paste text)
- Digest view (Markdown render, PDF export, history)
- Settings (jurisdictions, schedule, channels, **team & invitations**, **inbound mailbox**, **audiences**)

### 13. Marketing Landing (Next.js 15 App Router — `apps/landing`) 🆕

- Hero, features, pricing, demo CTA, blog scaffold
- Independent build/deploy cadence
- No auth, no product SDKs, no DB client — keep bundle minimal
- (MVP-1 ships only the empty skeleton; full content in POST-N `marketing-landing-content`)

### 14. Observability & Ops

- Pino structured logging with `organizationId`/`userId`/`scanId`/`alertId` correlation
- Sentry
- Metrics: scan duration, alerts/scan, dedup rate, LLM token spend, notification delivery
- Cost guardrails (per-org Gemini budget cap; circuit breaker)

### 15. Deployment

- Dockerfiles for `api`, `scanner`, `web`, **`landing`**
- Cloud Run services (4) wired to managed Postgres
- Inbound email webhook public endpoint
- Secret manager wiring
- Production migration workflow

### 16. Billing (post-MVP)

- Plan tiers (Starter / Growth / Enterprise) — billed per `Organization`
- Stripe subscriptions; gate jurisdictions / frequency / channels / audiences / seat-count by plan

---

## Section 3 — Slice Roadmap

**Total: 24 named slices** (16 MVP + 8 POST). MVP critical path lengthens by 1 due to the auth split. Post-MVP gains `marketing-landing-content` (POST-N).
Naming: `MVP-N` = required for first paying customer. `POST-N` = ships after MVP launch.

### Summary Table

| #          | change-name                        | tier | goal (one-liner)                                                                                                                                                                                                                                 | effort | deps                           |
| ---------- | ---------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------ |
| MVP-1      | `bootstrap-monorepo`               | MVP  | pnpm/Turbo monorepo with `apps/api`, `apps/scanner`, `apps/web`, **`apps/landing`**, `packages/db`, `packages/types`, `packages/config` all booting; CI green                                                                                    | M      | —                              |
| MVP-2      | `prisma-schema-baseline`           | MVP  | Full Prisma schema (incl. **Organization, User, Membership, Invitation, Role enum**, collaboration, audiences, inbound) migrated; seed loads jurisdictions; dedup invariant `(organizationId, sourceUrlHash)`                                    | M      | MVP-1                          |
| **MVP-3a** | **`auth-foundation`** 🆕           | MVP  | NextAuth (Google OAuth + magic link), `User` table, JWT signed with shared secret, NestJS `JwtStrategy`. **Single-tenant temporary** — no Orgs yet, JWT carries `userId` only                                                                    | M      | MVP-2                          |
| **MVP-3b** | **`organization-multitenancy`** 🆕 | MVP  | `Organization` + `Membership` + `Invitation` + `Role` enum; auto-create personal Org on first signup; JWT enriched with memberships; `X-Org-Id` header + `OrgScopeGuard`; `@Roles()` + `RolesGuard`; org switcher in `apps/web`; invite-by-email | L      | MVP-3a                         |
| MVP-4      | `jurisdictions-config`             | MVP  | `jurisdictions.ts` registry + `GET/PUT /api/settings` (per-Org) + per-org `customTopics` storage                                                                                                                                                 | S      | MVP-3b                         |
| MVP-5      | `scanner-vertical-ar` ⭐           | MVP  | NestJS `AgentsModule` in `apps/scanner` runs ONE AR scanner end-to-end, dedupes by `(organizationId, sourceUrlHash)`, persists `Alert`s, writes `ScanLog`. Triggered via API → queue.                                                            | L      | MVP-4                          |
| MVP-6      | `classifier-and-writer`            | MVP  | Pipeline produces stored `Digest` after each scan                                                                                                                                                                                                | M      | MVP-5                          |
| MVP-7      | `manual-ingestion`                 | MVP  | Paste URL / upload PDF / paste text → Alert (same pipeline, source=`manual`, scoped to `organizationId`)                                                                                                                                         | M      | MVP-6                          |
| MVP-8      | `alert-collaboration`              | MVP  | Status machine + assignee (must be Org `Member`) + comments + attachments + related-alerts on Alert                                                                                                                                              | L      | MVP-6                          |
| MVP-9      | `notify-slack`                     | MVP  | First notification channel (single-audience baseline)                                                                                                                                                                                            | S      | MVP-6                          |
| MVP-10     | `dashboard-mvp`                    | MVP  | Read-only Web UI: login → org switcher → dashboard (with **LatAm map**), alerts list, alert detail (workflow), digest detail                                                                                                                     | L      | MVP-8, MVP-9                   |
| MVP-11     | `onboarding-flow`                  | MVP  | 3-step wizard + "run first scan now" on the auto-created Org                                                                                                                                                                                     | M      | MVP-10                         |
| MVP-12     | `scheduler-per-org`                | MVP  | `@nestjs/schedule` per-`organizationId` cron registry; reschedule on Settings PUT; "next run" in API/UI                                                                                                                                          | M      | MVP-11                         |
| MVP-13     | `scanners-br-co-pe-cl`             | MVP  | Add the other 4 jurisdictions (parallelizable)                                                                                                                                                                                                   | M      | MVP-5                          |
| MVP-14     | `segmented-distribution`           | MVP  | Audiences (`team/c-level/legal/product/risk/custom`); audience members must be Org `Member`s; per-audience routing; refactor notify into audience-aware router                                                                                   | L      | MVP-9, MVP-8                   |
| MVP-15     | `email-inbound`                    | MVP  | Per-Org mailbox; Postmark Inbound webhook → parsed Alerts (source=`email`, scoped to `organizationId`)                                                                                                                                           | L      | MVP-7                          |
| POST-1     | `notify-teams`                     | POST | Microsoft Teams Adaptive Cards adapter behind audience router                                                                                                                                                                                    | S      | MVP-14                         |
| POST-2     | `notify-email-resend`              | POST | Resend HTML email + PDF export, audience-routed                                                                                                                                                                                                  | M      | MVP-14                         |
| POST-3     | `digest-export`                    | POST | PDF export + copy-as-Markdown from digest view                                                                                                                                                                                                   | S      | POST-2                         |
| POST-4     | `team-management-ui`               | POST | Polished invitations UI, role-change UX, seat counts. (Backend invitation primitives already in MVP-3b.)                                                                                                                                         | M      | MVP-3b                         |
| POST-5     | `settings-ui-full`                 | POST | Complete Settings UI wired to all backends (jurisdictions, schedule, channels, team, mailbox, audiences)                                                                                                                                         | M      | MVP-12, POST-1, POST-2, POST-4 |
| POST-6     | `observability`                    | POST | Pino correlation, Sentry, metrics, Gemini cost guard + circuit breaker                                                                                                                                                                           | M      | MVP-6                          |
| POST-7     | `deploy-cloud-run`                 | POST | Dockerfiles for **4 apps**, Cloud Run, Cloud SQL, Secret Manager, prod migration runbook, inbound mail public endpoint                                                                                                                           | L      | POST-6                         |
| POST-8     | `auth-ms-entra`                    | POST | Add Microsoft Entra ID provider to NextAuth (B2B compliance teams)                                                                                                                                                                               | S      | MVP-3a                         |
| POST-9     | `billing-stripe`                   | POST | Stripe subscriptions + plan-feature gating per `Organization`                                                                                                                                                                                    | L      | POST-7                         |
| POST-10    | `jurisdictions-v2`                 | POST | Add UY, MX, US, EU, UK (config-only; reuses pipeline). One micro-slice per country.                                                                                                                                                              | S each | MVP-13                         |
| **POST-N** | **`marketing-landing-content`** 🆕 | POST | Real content + design for `apps/landing`: hero, features, pricing, demo CTA, blog scaffold. Depends on brand/logo decision (open product question, not a tech blocker).                                                                          | M      | MVP-1                          |

> Note on numbering: the table lists 27 rows but `POST-10` is multi-country (5 micro-slices). The "24 named slices" headline counts each named change once.

### Detailed Slice Cards

#### MVP-1 · `bootstrap-monorepo`

- **goal**: Empty runnable monorepo. `pnpm dev` boots api on :3001, scanner on :3002, web on :3000, **landing on :3003**.
- **scope**: Turbo, root tsconfig/eslint/prettier; `apps/api` (NestJS hello-world), `apps/scanner` (NestJS hello-world), `apps/web` (Next.js 15 + shadcn `init`), **`apps/landing` (Next.js 15 skeleton — empty page, separate Tailwind config, no shared product deps)**; `packages/db` (Prisma init), `packages/types` (empty), `packages/config` (zod env loader); Docker compose with Postgres; CI typecheck + lint + Vitest; deploy stub for `apps/landing` (Vercel or Cloud Run — decide in POST-7 unification).
- **rationale for separate `apps/landing`**: independent perf budget (no auth/SDK weight in marketing pages), distinct deploy cadence (marketing iterates faster than product), distinct domain (`regwatch.app` vs `app.regwatch.app`), SEO/edge optimization without leaking the product bundle.
- **out-of-scope**: any business logic, auth, agents, ADK, landing content (POST-N).
- **dependencies**: none.
- **effort**: M (was M in v2 — kept M; 4th app is a skeleton).
- **top risks**: NestJS/Next.js peer-dep alignment with pnpm workspace hoisting; shadcn `init` inside Turbo monorepo (path resolution); two Next.js 15 apps not stepping on each other's Tailwind config.

#### MVP-2 · `prisma-schema-baseline`

- **goal**: Full schema migrated; seed inserts default jurisdictions; tenant-scoped repo helpers tested.
- **scope**: `schema.prisma` with all models — **`Organization` (principal entity), `User`, `Membership` (with `Role` enum: `OWNER | ADMIN | ANALYST | VIEWER`), `Invitation`**, `Settings`, `Alert`, `Digest`, `ScanLog`, `AlertComment`, `AlertAttachment`, `AlertAudience`, `InboundMailbox`, `InboundMessage`, `AlertSource` enum; initial migration; seed; **`organizationId`-scoped repo helpers**; `sourceUrlHash` util with **dedup invariant `(organizationId, sourceUrlHash)`**; Vitest unit tests for repos.
- **out-of-scope**: any agent or HTTP code; auth (MVP-3a/3b).
- **dependencies**: MVP-1.
- **effort**: M.
- **top risks**: Getting `Settings.jurisdictions` JSON shape and `AlertAudience` cardinality right early; `Membership` cascade-delete semantics when an Org is removed.

#### MVP-3a · `auth-foundation` 🆕

- **goal**: Real user logs in via Google OAuth or magic link; protected `apps/api` route returns their `userId`.
- **scope**: NextAuth in `apps/web` (Google + magic link via Resend); `User` row created/upserted on first login; JWT signed with shared secret carrying **`userId` + `email` only**; NestJS `JwtStrategy` (Passport) in `apps/api` with `@CurrentUser()` decorator; protected `GET /api/me` route returns `{ userId, email }`.
- **temporary single-tenant assumption**: this slice does NOT introduce Orgs. Endpoints downstream of MVP-3a (jurisdictions, scanner, etc.) MUST NOT ship until MVP-3b lands — otherwise multi-tenancy guards will be retro-fitted, which is exactly what we're avoiding.
- **out-of-scope**: Organization, Membership, Invitation, role enforcement, org switcher (all MVP-3b); MS Entra (POST-8).
- **dependencies**: MVP-2.
- **effort**: M.
- **top risks**: JWT shared-secret key rotation strategy; cross-app session cookie domain in dev vs prod.

#### MVP-3b · `organization-multitenancy` 🆕 ⭐ MVP-critical

- **goal**: User can belong to N Organizations, each with a role; every API request is org-scoped via `X-Org-Id`.
- **scope**:
  - Prisma is already in place from MVP-2 — this slice wires it end-to-end.
  - **Auto-org-on-signup hook** in NextAuth `signIn` callback: create personal `Organization` (name = "{firstName}'s workspace", slug = derived from email) + `Membership` with role `OWNER`.
  - **JWT enrichment**: session callback reads all active `Membership`s for the user and embeds them in JWT as `{ userId, email, memberships: [{orgId, role, orgSlug}] }`.
  - **`OrgScopeGuard`** (NestJS global guard): reads `X-Org-Id` header, validates membership against JWT, injects `organizationId` + `currentRole` into request scope (`@CurrentOrg()` + `@CurrentRole()` decorators).
  - **`@Roles(...)` decorator + `RolesGuard`**: enforce min-role per endpoint.
  - **Org switcher component** in `apps/web` header — lists user's memberships, persists selection in cookie, drives the `X-Org-Id` header for client→api calls.
  - **Invitation flow**: `POST /api/org/:orgId/invitations` (OWNER/ADMIN only) → email with token → `POST /api/invitations/:token/accept` creates `Membership`.
  - **`POST /api/org`** to create additional orgs (caller becomes `OWNER`).
  - **`GET /api/org/me`** returns current user's memberships.
- **decision: header vs path prefix**: chose **`X-Org-Id` header**. Rationale: keeps URLs stable across org switches (better for bookmarking/back-button UX), routing concerns stay decoupled from business endpoints, and the guard is a single piece of middleware rather than a parameterized prefix in every controller.
- **out-of-scope**: polished invitations UI / seat-count UX (POST-4 `team-management-ui`); cross-org transfer of resources.
- **dependencies**: MVP-3a.
- **effort**: L.
- **top risks**: JWT staleness when memberships change (mitigation: short TTL + silent refresh, OR include a `membershipsVersion` claim and refetch on mismatch); preventing `X-Org-Id` spoofing (guard MUST validate against JWT, never trust the header alone); org-switcher race conditions when client has stale data after a role change.

#### MVP-4 · `jurisdictions-config`

- **goal**: Settings exists per `Organization` with editable `customTopics`.
- **scope**: `jurisdictions.ts` registry; `SettingsModule` in `apps/api` with `GET/PUT /api/settings` (scoped via `OrgScopeGuard`); `@Roles(ADMIN, OWNER)` on `PUT`; zod validation; auto-create on first read for the active Org.
- **out-of-scope**: Settings UI (POST-5).
- **dependencies**: MVP-3b.
- **effort**: S.
- **top risks**: zod ↔ Prisma JSON schema drift.

#### MVP-5 · `scanner-vertical-ar` ⭐ vertical proof

- **goal**: `POST /api/scan` for an Org → AR scanner runs in `apps/scanner` → new `Alert`s appear scoped to `organizationId`; reruns are idempotent.
- **scope**: NestJS `AgentsModule` in `apps/scanner` wrapping ADK; root agent + 1 scanner (AR); `deduplicationTool` (uses `(organizationId, sourceUrlHash)`); `storageTool`; `ScanLog` lifecycle; in-process queue (BullMQ optional, in-memory for MVP) between `apps/api` trigger and `apps/scanner` worker — job payload carries `organizationId`.
- **out-of-scope**: classifier, writer, notifications, UI, other countries.
- **dependencies**: MVP-4.
- **effort**: L.
- **top risks**: ADK TS 1.0 maturity (must verify with 30-min spike); Gemini cost — **Gemini cost ceiling decision must be resolved before this slice starts**.

#### MVP-6 · `classifier-and-writer`

- **goal**: Pipeline produces a stored `Digest` (per-Org) after each scan.
- **scope**: `classifyTool` (severity + category); classifierAgent wiring; writerAgent (Markdown); `Digest` row written (scoped to `organizationId`); alert→digest linking.
- **out-of-scope**: delivery channels, UI render.
- **dependencies**: MVP-5.
- **effort**: M.
- **top risks**: Classification calibration; digest length/cost.

#### MVP-7 · `manual-ingestion`

- **goal**: User pastes URL / uploads PDF / pastes text → an `Alert` is created using the same pipeline as the scanner, scoped to active Org.
- **scope**: `POST /api/alerts/manual` in `apps/api` (org-scoped, role `ANALYST` or higher) that enqueues a `manual-ingest` job to `apps/scanner` carrying `organizationId` + `userId`; URL fetcher + readability extractor; PDF parser; raw-text passthrough; reuses dedup + classifier + storage with `source='manual'`; minimal UI drawer in `apps/web` (full UI polished in MVP-10).
- **out-of-scope**: bulk upload, OCR for image PDFs.
- **dependencies**: MVP-6.
- **effort**: M.
- **top risks**: PDF extraction quality on legal docs; URL fetcher timeouts/blocking.

#### MVP-8 · `alert-collaboration` ⭐ MVP-critical

- **goal**: Each Alert has a status workflow, assignee, comments, attachments, and related-alerts linking — all scoped to the Alert's Org.
- **scope**: Status machine (`new → triaging → analyzing → debating → concluded → distributed`) enforced server-side; **assignee MUST be a `User` with active `Membership` in the Alert's `organizationId`** (validated server-side); `AlertComment` CRUD (author must be a Member; comments scoped to the Org); `AlertAttachment` upload (signed URL to GCS or local for dev); related-alerts self-relation (only same-Org alerts linkable); audit log of transitions records `userId` + `role`; API endpoints; Vitest coverage of state transitions + cross-org guard tests.
- **out-of-scope**: real-time collab (websockets); rich-text comments — Markdown plain string for MVP.
- **dependencies**: MVP-6.
- **effort**: L.
- **top risks**: Status machine bypass via direct PATCH; cross-org assignee leak (must be tested explicitly); attachment storage decision (GCS bucket per Org vs single bucket + path scoping).

#### MVP-9 · `notify-slack`

- **goal**: When an alert is `distributed` (or scan completes with alerts ≥ `minSeverityNotify`), Slack message fires for the Alert's Org.
- **scope**: `notifyTool` v1 (single dispatcher, scoped per-Org); Slack adapter; "Test notification" endpoint (role `ADMIN`+); Settings honors `notifySlack` + `slackWebhook`.
- **out-of-scope**: audience routing (MVP-14), Teams, email.
- **dependencies**: MVP-6.
- **effort**: S.
- **top risks**: Webhook secret leakage; rate limits.

#### MVP-10 · `dashboard-mvp`

- **goal**: Logged-in user, after picking an Org from the switcher, sees their latest digest, alert list with filters, full alert detail page with workflow, **LatAm activity map**.
- **scope**: layout/nav (shadcn) + **org switcher in header**; dashboard (severity chips, critical+high list, recent digests, **react-simple-maps LatAm component**); alerts list with filters (severity / jurisdiction / category / status / source / assignee / audience / date); alert detail page (status workflow controls, assignee picker showing only Org Members, comments thread, attachments, related-alerts); digest detail page (Markdown render); manual-ingestion drawer.
- **out-of-scope**: onboarding (MVP-11), settings UI (POST-5), PDF export (POST-3), org-switcher `⌘K` palette (revisit during slice — see Open Decisions).
- **dependencies**: MVP-8, MVP-9.
- **effort**: L.
- **top risks**: Map performance with frequent updates; alert detail page complexity; org-switch state management (cache invalidation on switch).

#### MVP-11 · `onboarding-flow`

- **goal**: First-time user (with auto-created personal Org) completes 3-step wizard and runs first scan.
- **scope**: Detect missing `Settings` for active Org → redirect; 3 steps + confirmation; "run first scan now" with progress UI per scanner.
- **out-of-scope**: full Settings editing (POST-5); inviting teammates during onboarding (handled later in POST-4).
- **dependencies**: MVP-10.
- **effort**: M.
- **top risks**: Long first-scan wait UX; partial-failure UX if one scanner fails.

#### MVP-12 · `scheduler-per-org`

- **goal**: Scans run automatically on each Org's schedule.
- **scope**: `@nestjs/schedule` `SchedulerRegistry` in `apps/scanner`; on boot, load all `Settings`, register dynamic cron per `organizationId`; on Settings PUT, emit event → cancel + recreate; expose "next run" via `apps/api`.
- **out-of-scope**: horizontal scaling (Cloud Scheduler migration is a future concern).
- **dependencies**: MVP-11.
- **effort**: M.
- **top risks**: Single-process scheduler doesn't scale beyond one scanner pod — document migration path to Cloud Scheduler at scale.

#### MVP-13 · `scanners-br-co-pe-cl`

- **goal**: 4 more jurisdictions live; each is a `jurisdictions.ts` config entry + agent instantiation.
- **scope**: BR / CO / PE / CL configs; per-country prompt calibration; smoke tests.
- **out-of-scope**: UY/MX/US/EU/UK (POST-10).
- **dependencies**: MVP-5.
- **effort**: M.
- **top risks**: Per-regulator quirks (PDF-only sources, Portuguese language for BR).

#### MVP-14 · `segmented-distribution` ⭐ MVP-critical

- **goal**: Concluded alerts can target one or more audiences (each composed of Org Members), each with its own routing config.
- **scope**: `AlertAudience` model + API; **audience members must be `User`s with active `Membership` in the Alert's Org** (validated server-side); audience selector UI on alert detail; refactor `notifyTool` from single dispatcher to **audience-aware router** (per-audience channel preferences); transition `concluded → distributed` triggers per-audience dispatch; default audiences seeded per-Org (`team`, `c-level`, `legal`, `product`, `risk`); custom audience CRUD (role `ADMIN`+).
- **out-of-scope**: Teams (POST-1), Resend email (POST-2).
- **dependencies**: MVP-9, MVP-8.
- **effort**: L.
- **top risks**: Routing config explosion (matrix of audience × channel × Org) — keep config minimal in MVP; cross-org audience-member leak; product positioning UX (must surface "augments law firm" framing in distribution UI copy).

#### MVP-15 · `email-inbound`

- **goal**: Each Org can forward newsletters / law-firm digests to a per-Org inbox; incoming emails become Alerts.
- **scope**: Postmark Inbound configuration; webhook endpoint in `apps/scanner` (`POST /webhooks/inbound-email`); per-Org mailbox provisioning (`alerts-{orgslug}@inbound.regwatch.app` or forward-to address stored in `InboundMailbox` keyed by `organizationId`); email parser (subject + body + attachments → 1+ Alerts with `source='email'`, scoped to `organizationId`); same dedup + classifier + storage path; `InboundMessage` audit row.
- **out-of-scope**: outbound email (POST-2); IMAP polling (Postmark webhook only); conversation threading.
- **dependencies**: MVP-7.
- **effort**: L.
- **top risks**: Spam / unsigned senders (require allowlist per Org); attachment size limits; one-email-N-novelties parsing accuracy.

#### POST-1 · `notify-teams`

- Adapter behind the audience router (MVP-14). Adaptive Cards payload.

#### POST-2 · `notify-email-resend`

- Resend HTML adapter behind audience router; honors per-audience email lists (Org Members only).

#### POST-3 · `digest-export`

- PDF + copy-as-Markdown from digest view.

#### POST-4 · `team-management-ui`

- Polished invitations UI (compose, resend, revoke), role-change UX, seat counts, member list. Backend invitation primitives already shipped in MVP-3b — this slice is the polished UX layer.

#### POST-5 · `settings-ui-full`

- Polished Settings UI for jurisdictions, schedule, channels (Slack/Teams/Email), team, **inbound mailbox**, **audiences**.

#### POST-6 · `observability`

- Pino correlation (`organizationId` / `userId` / `scanId` / `alertId`), Sentry, basic metrics, Gemini cost meter + per-Org circuit breaker.

#### POST-7 · `deploy-cloud-run`

- **Four** Dockerfiles (api / scanner / web / **landing**), **four** Cloud Run services (or Vercel for landing — decide here), Cloud SQL, Secret Manager, public inbound-email endpoint, GitHub Actions deploy, prod migration runbook.

#### POST-8 · `auth-ms-entra`

- Add Microsoft Entra ID provider to NextAuth (B2B compliance teams in regulated enterprises). Plugs into the existing MVP-3a foundation; multi-tenancy already in place from MVP-3b.

#### POST-9 · `billing-stripe`

- Stripe subscriptions per `Organization` + plan-feature gating (jurisdictions / frequency / channels / audiences / seat-count).

#### POST-10 · `jurisdictions-v2`

- One micro-slice per new country: UY, MX, US, EU, UK. Cheap if pipeline is solid.

#### POST-N · `marketing-landing-content` 🆕

- **goal**: Replace the empty `apps/landing` skeleton from MVP-1 with the real marketing site.
- **scope**: Hero, features grid, pricing tiers (post-billing), demo CTA (calendly/loom), blog scaffold (MDX), SEO (metadata, sitemap, robots), analytics, OG images. Independent Tailwind theme aligned with brand guidelines.
- **dependencies**: MVP-1 (skeleton). **Open product question**: needs brand/logo defined — flagged as a product blocker, NOT a tech blocker. Engineering can build component shells in parallel with brand work.
- **effort**: M.
- **top risks**: Brand decisions slipping; pricing-page coupling to POST-9 `billing-stripe` (mitigation: ship with placeholder pricing, swap when billing lands).

### Parallelization Map

- **MVP-3a → MVP-3b** is now a hard sequential dependency (cannot parallelize).
- After **MVP-5**: MVP-13 (other countries) parallelizable.
- After **MVP-6**: MVP-7 (manual-ingestion), MVP-8 (collaboration), and MVP-9 (Slack) all parallelizable.
- After **MVP-9 + MVP-8**: MVP-14 (segmented-distribution) and MVP-10 (dashboard) start in parallel.
- After **MVP-14**: POST-1 (Teams) and POST-2 (Resend email) parallelizable.
- POST-4 (team UI) can run in parallel with most UI slices once MVP-3b lands.
- POST-8 (MS Entra) is independent once MVP-3a is done.
- **POST-N (marketing-landing-content)** is parallelizable with the entire MVP track once MVP-1 is done — it's a pure marketing/design effort gated only on brand.

---

## Section 4 — Recommended First Slice

**`/sdd-new bootstrap-monorepo`**

**Why**: Zero dependencies, unblocks everything else, and forces the full layout to materialize from day one — **four apps** (`api`/`scanner`/`web`/`landing`), three packages (`db`/`types`/`config`), pnpm + Turbo, NestJS scaffolds, two Next.js 15 apps (product + landing) + shadcn `init` (web only), Postgres compose, Vitest + Playwright skeletons, CI green. Doing this monolithically up front avoids two future pain points: (1) the "v1.5 split" we'd hit in MVP-5 if `apps/scanner` didn't exist yet, and (2) the marketing-vs-product bundle entanglement we'd hit if `apps/landing` was added later inside `apps/web`. Ship it, then go straight to `prisma-schema-baseline` (MVP-2) so MVP-3a/3b have the full Org+Membership schema ready to wire.

---

## Section 5 — Open Decisions

Only one technical blocker remains. Plus one product detail to revisit during implementation.

| #   | Decision                              | Options                                                                       | Status / Recommendation                                                                                                                                                                                                                                  |
| --- | ------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Gemini cost ceiling per Org/month** | Pick a $/Org/month + behavior on cap (block / degrade / admin alert)          | ⏳ **Blocker before MVP-5**. Recommendation: $20/Org/mo Flash budget, soft-block scans with admin alert. Confirm with stakeholder before MVP-5.                                                                                                          |
| 2   | **Org-switcher UX**                   | Header dropdown only / Header + `⌘K` command palette (Linear-style) / Sidebar | 💭 Not a blocker. Revisit during MVP-3b (basic dropdown is enough to ship) or MVP-10 (when adding the polished switcher). Lean toward `⌘K` palette for power-user UX since compliance teams will likely manage multiple orgs (parent co + subsidiaries). |
| 3   | **Brand / logo for `apps/landing`**   | TBD with founder/designer                                                     | 💭 Not a tech blocker. Blocks POST-N `marketing-landing-content` content/design but NOT the MVP-1 skeleton. Engineering can build component shells in parallel.                                                                                          |

All other v1/v2 decisions resolved (see Section 1).
