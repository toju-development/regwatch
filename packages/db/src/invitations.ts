/**
 * Invitation status helpers — sdd/org-invitations (MVP-3b3b) D8.
 *
 * COMPUTED status is the SOLE source of truth across API serializers,
 * list filtering, preview responses, and tests. There is NO `status`
 * column on the `Invitation` table and NO cron flipping PENDING→EXPIRED.
 *
 * Precedence (highest first): REVOKED > ACCEPTED > EXPIRED > PENDING.
 *  - REVOKED beats EXPIRED: explicit user action wins over implicit time decay.
 *  - ACCEPTED beats EXPIRED: a successful acceptance is terminal even if the
 *    deadline has since passed (membership already exists).
 */

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

/**
 * Subset of `Invitation` fields needed to derive status. Loose-typed so
 * callers can pass either a Prisma row, a partial DTO, or a test fixture
 * without coupling this helper to the generated client (which would force
 * `packages/db` consumers to import the whole client surface).
 */
export interface InvitationStatusInput {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}

/**
 * Pure function. No I/O, no Date.now() side effects — `now` is injected so
 * callers (services, tests) can pin time deterministically. Defaults to
 * `new Date()` for ergonomic call sites.
 *
 * Edge case: when `expiresAt === now` the invitation is still PENDING
 * (strict `<` comparison). This matches the spec scenario language
 * ("`now > expiresAt`") and gives the caller exactly one tick of grace.
 */
export function computeInvitationStatus(
  inv: InvitationStatusInput,
  now: Date = new Date(),
): InvitationStatus {
  if (inv.revokedAt !== null) return 'REVOKED';
  if (inv.acceptedAt !== null) return 'ACCEPTED';
  if (inv.expiresAt.getTime() < now.getTime()) return 'EXPIRED';
  return 'PENDING';
}
