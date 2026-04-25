# PR notes — `feat/auth-foundation` (MVP-3a slice)

> Paste this as the PR description. Branch `feat/auth-foundation` @ `234d938` (pre-B7 docs commit; refresh SHA when squashing if needed).

## Summary

End-to-end identity foundation: NextAuth v5 in `apps/web` (Google OAuth + Resend Magic Link) issues HS256 JWS tokens; `apps/api` validates them per-request via a global `JwtAuthGuard` (jose). Trust boundary = shared `AUTH_SECRET`. Every signed-in user gets exactly one personal `Organization` + `Membership(OWNER)` in the same transaction (auto-org-on-signup invariant).

Scope-lock **S2**: MVP-3a + `memberships[]` claim. NO guards / invitations / org switcher / middleware (deferred to MVP-3b).

## What shipped (per batch)

| Batch                          | What                                                                                                                                                                                                                                      | Key commits           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **B1** Schema + migration      | `User.emailVerified/image`, `Account`, `VerificationToken` (Auth.js canonical, cascade-delete), `add_authjs_tables` migration                                                                                                             | `fb73599`             |
| **B2** Per-app env slices      | `createCoreEnv` / `createWebEnv` / `createApiEnv` factories; web-only vars unreachable from `apps/api`; `AUTH_SECRET` shared in core (≥32 chars)                                                                                          | `1c0282b`, `3a60093`  |
| **B3** Shared types            | `JwtClaims`, `MembershipClaim`, `AuthUser`, `Role` in `@regwatch/types`                                                                                                                                                                   | `bcf53b7`             |
| **B4** `apps/web` NextAuth     | NextAuth v5 wiring, HS256 JWS encode/decode override (R-Sign), auto-org `$transaction` + slug-collision retry, in-memory email transport, `/api/test/inbox/[email]`, fake-google credentials provider, `/login` page                      | `c4359da` … `116e4c1` |
| **B5** `apps/api` JwtAuthGuard | `JwtVerifier` (jose, cached secret, iss/aud), `JwtAuthGuard` (`APP_GUARD`), `@Public()`, `@CurrentUser()`, `/health` marked public                                                                                                        | `c4a167f` … `e01a3ed` |
| **B6** Tests + CI              | vitest API (14/14), vitest web (11/11), Playwright e2e (4/4 with 2 fixmes at the time), `_test/me` canary endpoint, dual-webServer Playwright config, NodeNext `.js` extensionAlias for Next webpack, CI postgres + auth env on both jobs | `a0e590c` … `18fc84a` |
| **B6.5** E2E hotfix            | Removed both `test.fixme()` markers — root cause was Playwright/Chromium quirks, NOT auth code                                                                                                                                            | `234d938`             |
| **B7** Docs                    | Root README + `apps/web/README.md` auth section, this PR notes file                                                                                                                                                                       | (this PR)             |

## Decisions locked

| Q                | Decision                                                | Rationale                                                                                                                    |
| ---------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Q-Scope          | **S2** (MVP-3a + memberships claim only)                | Keep slice ≤ 4 days; no guards/invites/switcher                                                                              |
| Q1               | NextAuth v5 in web; `apps/api` is verifier only         | Cross-runtime via stateless JWT                                                                                              |
| Q2               | `session.strategy: 'jwt'` (no Session table)            | Avoid per-request DB hit on api                                                                                              |
| Q3 / R-Sign      | **Override `jwt.encode/decode` to HS256 JWS**           | Auth.js v5 default is JWE A256CBC-HS512; `jose.jwtVerify` only accepts JWS. Documented in `apps/web/src/lib/auth.ts` header. |
| Q4               | Auto-org via `events.createUser` + `$transaction`       | Atomic User + Org + Membership(OWNER)                                                                                        |
| Q5               | `memberships` claim capped at 50                        | JWT size ceiling; truncate + warn beyond                                                                                     |
| Q6               | Single `AUTH_SECRET` shared in `createCoreEnv` (min 32) | Trust boundary lives in env                                                                                                  |
| Q7               | Magic Link 24h, single-use (Auth.js default)            | No bespoke override                                                                                                          |
| Q8               | NO `apps/web/middleware.ts` in 3a                       | Defer route gating to 3b; `auth.config.ts` already edge-safe                                                                 |
| Q9 / R-Slug-deps | Hand-rolled slugifier + 16-bit hex suffix retry         | Avoid `@sindresorhus/slugify` + `nanoid` deps                                                                                |
| `next-auth` pin  | **`5.0.0-beta.31` exact**                               | Beta channel — avoid silent breakage on `^` bumps                                                                            |

## Test status

| Suite                     | Result         | Notes                                                                                             |
| ------------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| `apps/api` vitest         | **14 / 14 ✅** | jwt-verifier (6) + jwt-auth.guard (7) + smoke (1)                                                 |
| `apps/web` vitest         | **11 / 11 ✅** | auto-org slugify + collision retry (10) + smoke (1)                                               |
| `apps/web` Playwright e2e | **4 / 4 ✅**   | health (1) + auth (3): 401 without Bearer, 200 with Bearer via fake-google, magic link round-trip |
| Lint / typecheck          | green          | per-app overrides, NodeNext ESM with `.js` suffix                                                 |

CI (`.github/workflows/ci.yml`) provisions Postgres on both jobs and shares the auth env block — no manual secrets needed for CI.

## Foot-guns discovered (saved to engram)

Captured in `regwatch/footguns/next15-authjs-v5` for future reference:

1. **Next App Router private prefix** — folders starting with `_` are non-routable. `_test/` → `test/`.
2. **Server Action ↔ Route Handler module-graph split** — module-scoped state lives in _two_ instances at runtime in Next 15. Hoist to `globalThis` (Symbol-tagged) when sharing.
3. **Playwright `page.goto` on same-origin 302 with no body → Chromium `ERR_ABORTED`** — drive via `context.request.get(url, { maxRedirects: 0 })` to share the cookie jar.
4. **Playwright `page.click()` returns on dispatch, not navigation** — never use a `waitForURL` predicate that is already true at click time. Race the click against `page.waitForResponse(...)`.
5. **Auth.js v5 default JWT envelope = JWE, not JWS** — must override `jwt.encode/decode` to HS256 JWS for `jose.jwtVerify` to accept it. **R-Sign**.

Plus, captured separately as `architecture/nestjs-tsx-decorator-metadata`:

6. **`tsx` does not emit `design:paramtypes`** even with `emitDecoratorMetadata: true` — every NestJS `@Injectable` with constructor deps in `apps/api` MUST use explicit `@Inject(Token)`. Long-term fix (own slice): switch to `@swc-node/register` or add a real tsc/swc build step.

## Out of scope (next slice — MVP-3b)

- `apps/web/middleware.ts` route gating
- `RolesGuard` / `OrgScopeGuard` / `X-Org-Id` enforcement on `apps/api`
- Invitation acceptance endpoint + flow (S5 carry-over)
- Org-switcher UI
- JWT freshness on membership mutation (re-issue / `update()` trigger wiring; the hook in `callbacks.jwt({ trigger: 'update' })` is already in place)
- Real Google OAuth client provisioning + Resend domain verification (deploy slice)

## Reviewer focus

1. `apps/web/src/lib/auth.ts` — confirm the HS256 override matches `apps/api/src/common/auth/jwt-verifier.ts`.
2. `apps/web/src/lib/auto-org.ts` — slug-collision retry path (covered by 10 vitest cases).
3. `apps/api/src/common/auth/jwt-auth.guard.ts` — `@Public()` honoring + `@Inject(Token)` on every constructor param (tsx requirement).
4. `.github/workflows/ci.yml` — auth env block on both jobs + postgres service on e2e.

## Engram references

Full SDD artifacts (`mem_search` against project `regwatch`):

- `sdd/auth-foundation/proposal` · `sdd/auth-foundation/spec` · `sdd/auth-foundation/design` · `sdd/auth-foundation/tasks` · `sdd/auth-foundation/apply-progress`
- `regwatch/footguns/next15-authjs-v5` · `architecture/nestjs-tsx-decorator-metadata`
