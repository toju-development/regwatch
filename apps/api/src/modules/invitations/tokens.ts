/**
 * DI tokens for `InvitationsModule` (MVP-3b3b B4).
 *
 * Foot-gun #667: tsx (esbuild) does NOT emit `design:paramtypes`
 * decorator metadata — every cross-module / cross-interface inject MUST
 * use a `Symbol`-keyed token paired with explicit `@Inject(TOKEN)` on
 * the constructor parameter. Interface-typed lookups silently resolve
 * to `undefined` and the service throws on first call.
 *
 * - {@link INVITATIONS_REPO}        — persistence boundary (`InvitationsRepo`).
 * - {@link TOKEN_GENERATOR}         — opaque random token producer; service
 *                                     never calls `crypto` directly so unit
 *                                     tests can pin tokens deterministically.
 * - {@link INVITATION_TTL_DAYS}     — `expiresAt = now + N days` lever
 *                                     surfaced as a token so tests can pin a
 *                                     short TTL when exercising EXPIRED paths.
 * - {@link WEB_URL}                 — base origin used to build the
 *                                     `acceptUrl` carried by the
 *                                     `invitation.created` event payload.
 *                                     Distinct from `API_URL` (proxy mode
 *                                     #666). B7 promotes this to a typed
 *                                     env fragment.
 *
 * Spec: `sdd/org-invitations/spec` R-Email-Port-Hexagonal (acceptUrl shape).
 * Design: `sdd/org-invitations/design` D5 (token generator), §3 (DI).
 */
export const INVITATIONS_REPO = Symbol('INVITATIONS_REPO');
export const TOKEN_GENERATOR = Symbol('TOKEN_GENERATOR');
export const INVITATION_TTL_DAYS = Symbol('INVITATION_TTL_DAYS');
export const WEB_URL = Symbol('WEB_URL');

/**
 * Producer interface for the {@link TOKEN_GENERATOR} provider.
 *
 * The default provider in `InvitationsModule` returns
 * `crypto.randomBytes(32).toString('base64url')` (43 chars, 256-bit
 * entropy). Tests can replace this with a deterministic stub via
 * `useValue: { generate: () => 'fixed-token-a' }`.
 */
export interface TokenGenerator {
  generate(): string;
}
