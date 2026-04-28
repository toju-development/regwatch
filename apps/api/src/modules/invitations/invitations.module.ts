import { Module } from '@nestjs/common';
import { generateInvitationToken } from '@regwatch/db/tokens';
import { InvitationsService } from './invitations.service.js';
import { PrismaInvitationsRepo } from './invitations.repo.js';
import {
  INVITATIONS_REPO,
  INVITATION_TTL_DAYS,
  TOKEN_GENERATOR,
  WEB_URL,
  type TokenGenerator,
} from './tokens.js';

/**
 * `InvitationsModule` — domain home for the invitation lifecycle.
 *
 * Spec: `sdd/org-invitations/spec`.
 * Design: `sdd/org-invitations/design` §3 (DI), D5 (token generator),
 *   D3 (event emit — the listener lives in `EmailModule`).
 *
 * **B4 (this commit) wires:**
 *   - `INVITATIONS_REPO` → `PrismaInvitationsRepo`.
 *   - `InvitationsService` (consumes `MembersService` from the global
 *     `MembersModule` — the architectural chokepoint for the accept
 *     INSERT path is `MembersService.createOrGet`).
 *   - `TOKEN_GENERATOR` → `{ generate: generateInvitationToken }` —
 *     32 bytes of base64url entropy. Tests rebind via `useValue` for
 *     deterministic assertions.
 *   - `INVITATION_TTL_DAYS` → `process.env.INVITATION_TTL_DAYS ?? 7`.
 *     Read straight off `process.env` for B4; B7 promotes this to a
 *     typed env fragment (engram `regwatch/pending/web-url-env-fragment`).
 *   - `WEB_URL` → `process.env.WEB_URL ?? 'http://localhost:3000'`.
 *     Used to build the `acceptUrl` on the `invitation.created` event;
 *     intentionally distinct from `API_URL` (proxy mode #666).
 *
 * **B5 will add**: `InvitationsController` + `AcceptController` mounting
 * the routes onto this module's DI graph.
 *
 * NOT `@Global()`: nothing outside this module currently needs to inject
 * `InvitationsService`. `EventEmitter2` (events) and `MembersService`
 * (chokepoint) are already global; this module is a strict consumer.
 *
 * Foot-gun #667: every consumer uses `@Inject(<symbol>)` — service
 * constructor is explicit by symbol token.
 */
@Module({
  providers: [
    InvitationsService,
    { provide: INVITATIONS_REPO, useClass: PrismaInvitationsRepo },
    {
      provide: TOKEN_GENERATOR,
      useValue: { generate: generateInvitationToken } satisfies TokenGenerator,
    },
    {
      provide: INVITATION_TTL_DAYS,
      useValue: parsePositiveIntEnv(process.env.INVITATION_TTL_DAYS, 7),
    },
    {
      provide: WEB_URL,
      useValue: process.env.WEB_URL ?? 'http://localhost:3000',
    },
  ],
  exports: [InvitationsService],
})
export class InvitationsModule {}

/**
 * Parse `value` as a positive integer or fall back to `fallback`. Used
 * for `INVITATION_TTL_DAYS` so a malformed env value (`"abc"`, `"-3"`)
 * doesn't silently cascade into a `new Date(NaN)` expiresAt.
 */
function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}
