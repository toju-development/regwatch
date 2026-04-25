# `@regwatch/web` — Next.js 15 frontend + auth issuer

Port `3000`. Stack: Next.js 15 App Router (RSC), React 19, Tailwind 4, shadcn/ui, NextAuth v5.

> Repo-level docs: [root README](../../README.md). Auth overview: [Authentication section](../../README.md#authentication-mvp-3a--auth-foundation).

---

## Auth architecture (MVP-3a)

`apps/web` is the only **issuer** of session JWTs. `apps/api` is a stateless **verifier**.

```
Browser ─► /login ─► signIn('google'|'resend'|'google-fake')
              │
              ▼
       NextAuth v5 (src/lib/auth.ts)
              │
              ├── adapter: @auth/prisma-adapter
              ├── session.strategy: 'jwt'           (no Session table)
              ├── jwt.encode/decode: HS256 JWS       (R-Sign — overrides Auth.js v5 default JWE)
              ├── callbacks.jwt:    refetch memberships on signIn / update
              ├── callbacks.session: expose AuthUser to RSC
              └── events.createUser: createPersonalOrgForUser($transaction)
              │
              ▼
       cookie: __Secure-authjs.session-token (HS256 JWS, AUTH_SECRET-signed)
              │
              ▼
       RSC / Server Action: const { user } = await auth();
                            fetch(API, { Authorization: `Bearer ${token}` })
```

### File map (auth-relevant)

| Path                                      | Role                                                                                                                                                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/auth.config.ts`                  | Edge-safe slice (no Prisma, no Resend). Imported by future middleware.                                                                                                                                                      |
| `src/lib/auth.ts`                         | Node-only NextAuth instance (`handlers, auth, signIn, signOut`). Owns the HS256 JWS encode/decode override.                                                                                                                 |
| `src/lib/auto-org.ts`                     | `createPersonalOrgForUser(prisma, user)` — `$transaction` + 5-attempt slug-collision retry (16-bit hex suffix). Hand-rolled slugifier (R-Slug-deps).                                                                        |
| `src/lib/auth-providers/fake-google.ts`   | Credentials provider, id `google-fake`. Mounted only when `AUTH_FAKE_GOOGLE === '1'`. Bypasses the adapter, calls `createPersonalOrgForUser` directly.                                                                      |
| `src/lib/auth-email/memory-transport.ts`  | In-process inbox keyed off `globalThis` (foot-gun #2 — Server Action ↔ Route Handler module split).                                                                                                                         |
| `src/app/api/auth/[...nextauth]/route.ts` | `export const { GET, POST } = handlers;`                                                                                                                                                                                    |
| `src/app/api/test/inbox/[email]/route.ts` | Reads memory inbox. Double-guarded: 404 unless `NODE_ENV !== 'production'` AND `EMAIL_TRANSPORT === 'memory'`. **Folder is `test/`, not `_test/`** (foot-gun #1 — Next App Router treats `_`-prefixed segments as private). |
| `src/app/login/page.tsx`                  | RSC shell: Google button + email form + (when `AUTH_FAKE_GOOGLE=1`) fake-google form. Renders `?error=` if present.                                                                                                         |

### JWT shape (canonical)

```ts
// packages/types/src/auth.ts
{
  sub: string;            // userId
  email: string;
  memberships: Array<{    // capped at 50; > 50 truncates + warns
    organizationId: string;
    orgSlug: string;
    role: 'OWNER' | 'ADMIN' | 'ANALYST' | 'VIEWER';
  }>;
  iat: number; exp: number;
  iss?: string;           // 'regwatch-web' when JWT_ISSUER set
  aud?: string;           // 'regwatch-api' when JWT_AUDIENCE set
}
```

`maxAge` 30 days. `jwt({ trigger: 'update' })` refetches memberships — entry point for MVP-3b membership-mutating endpoints.

---

## Env vars

See [`.env.example`](./.env.example). Composes the root `.env` (`AUTH_SECRET`, optional `JWT_ISSUER`/`JWT_AUDIENCE`) with the web slice (`AUTH_URL`, `AUTH_GOOGLE_ID/SECRET`, `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM`, `EMAIL_TRANSPORT`, `AUTH_FAKE_GOOGLE`). Loaded via `createWebEnv()` from `@regwatch/config`.

Dev/CI default: `EMAIL_TRANSPORT=memory` + `AUTH_FAKE_GOOGLE=1` — no real Google or Resend credentials required.

> **`SKIP_ENV_VALIDATION`** (build-time only): set by CI on the `pnpm build` step so `next build`'s page-data collection of `/api/auth/[...nextauth]` doesn't trip on absent runtime secrets. Never set in dev, tests, or runtime — fail-fast validation is preserved everywhere it matters.

---

## Tests

```bash
pnpm -F @regwatch/web test       # vitest — 11/11 (auto-org + smoke)
pnpm -F @regwatch/web test:e2e   # Playwright — 4/4 (auth e2e)
```

Playwright dual-webServer config boots both `apps/web` (3000) and `apps/api` (3001) so the protected-route Bearer flow can exercise the real API verifier. See `playwright.config.ts`.

### E2E foot-guns to remember

Captured in engram `regwatch/footguns/next15-authjs-v5` (full repro + fixes):

1. **Auth.js callback redirect → Chromium ERR_ABORTED**: drive same-origin 302-with-no-body via `context.request.get(url, { maxRedirects: 0 })`, NOT `page.goto(url)`. The APIRequestContext shares the cookie jar.
2. **`page.click()` resolves on dispatch, not navigation**: never use a `waitForURL` predicate that is already true at click-time. Race click against `page.waitForResponse(...)` and use a positive destination predicate.

---

## Deferred (MVP-3b)

- `middleware.ts` route gating (slice imports `auth.config.ts` only)
- `RolesGuard` / `OrgScopeGuard` / `X-Org-Id` enforcement
- Invitation acceptance flow
- Org-switcher UI
- JWT freshness on membership change (re-issue trigger)
