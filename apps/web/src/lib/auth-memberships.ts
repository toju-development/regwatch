/**
 * `fetchMemberships(userId)` — extracted from `apps/web/src/lib/auth.ts`
 * so the NextAuth `jwt` callback's `trigger === 'update'` path is
 * directly testable against a real Postgres without booting NextAuth or
 * running the OAuth dance.
 *
 * Spec: `sdd/org-membership-ux/spec` R-Jwt-Refresh-OnSelfCreate
 *   ("the next decoded JWT contains N+1 entries in `memberships[]`").
 *
 * Design: `sdd/org-membership-ux/design` §5 — `update()` propagation
 * audit (B2.3). The function MUST:
 *   - SELECT the user's memberships (capped at `MEMBERSHIPS_CLAIM_CAP`
 *     to keep JWT bytes bounded — JWT-size invariant from MVP-3a).
 *   - PROJECT to the JWT-shaped `MembershipClaim` (`organizationId`,
 *     `orgSlug`, `role`).
 *   - WARN (not throw) on cap-hit so operators can spot users approaching
 *     the limit before MVP-3b adds membership-mutating endpoints.
 *
 * The function is the canonical source of "what lands in the JWT after
 * `update()`" — both the production callback in `auth.ts` AND the
 * integration test in `auth-memberships.spec.ts` import this same
 * implementation. No drift possible.
 */
import type { PrismaClient } from '@regwatch/db';
import { MEMBERSHIPS_CLAIM_CAP, type MembershipClaim, type Role } from '@regwatch/types';

/**
 * Read the user's memberships and project to JWT-shaped claims.
 *
 * @param prisma - Live `PrismaClient` (production) or test client.
 * @param userId - The User PK to query against.
 * @returns Array of `MembershipClaim` capped at `MEMBERSHIPS_CLAIM_CAP`.
 */
export async function fetchMemberships(
  prisma: PrismaClient,
  userId: string,
): Promise<MembershipClaim[]> {
  const rows = await prisma.membership.findMany({
    where: { userId },
    take: MEMBERSHIPS_CLAIM_CAP,
    select: {
      organizationId: true,
      role: true,
      organization: { select: { slug: true } },
    },
  });
  if (rows.length === MEMBERSHIPS_CLAIM_CAP) {
    // Capped — JWT size invariant. Membership-mutating endpoints land
    // in MVP-3b; this warning lets operators see when users approach
    // the boundary before that lands.
    console.warn(
      `[auth] memberships truncated at MEMBERSHIPS_CLAIM_CAP=${MEMBERSHIPS_CLAIM_CAP} for userId=${userId}`,
    );
  }
  return rows.map(
    (r: { organizationId: string; role: string; organization: { slug: string } }) => ({
      organizationId: r.organizationId,
      orgSlug: r.organization.slug,
      role: r.role as Role,
    }),
  );
}

/**
 * Read the user's `User.membershipsVersion` for embedding into a fresh JWT
 * as the `mv` claim.
 *
 * Spec: `sdd/org-members/spec` R-Jwt-Invalidate-Cross-User + R-User-Memberships-Version.
 *
 * The column is bumped (atomically with every Membership write) inside
 * `apps/api`'s `MembersService.mutate()` chokepoint. The JWT callback
 * calls this function on initial sign-in AND on every NextAuth `update({})`
 * trigger, so silent re-mints carry the latest version.
 *
 * Returns `0` if the user row is missing (defensive — `update({})` race
 * after account deletion). The freshness guard treats `0` as a real value;
 * it just won't match a positive live version, which is the correct outcome.
 */
export async function fetchMembershipsVersion(
  prisma: PrismaClient,
  userId: string,
): Promise<number> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { membershipsVersion: true },
  });
  return row?.membershipsVersion ?? 0;
}
