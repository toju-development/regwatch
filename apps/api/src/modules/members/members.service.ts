import { Inject, Injectable } from '@nestjs/common';
import { MEMBERS_REPO_TOKEN, type MembersRepo } from './members.repo.js';

/**
 * Members domain service.
 *
 * **B2 scope (this commit)** — one read method only, consumed by
 * `MembershipFreshnessGuard` (with a 30s in-process cache):
 *
 *   - {@link MembersService.getCurrentVersion} → `User.membershipsVersion`
 *
 * **Out of scope here, lands in B3**: the transactional `mutate()`
 * chokepoint that (a) loads target membership, (b) enforces last-OWNER
 * / personalOrg / self-promote / ADMIN-vs-OWNER invariants, (c) writes
 * the `Membership` row, and (d) bumps `User.membershipsVersion` in the
 * SAME `prisma.$transaction` (foot-gun #645). The chokepoint contract
 * is designed in `sdd/org-members/design` §2 service order.
 *
 * Foot-gun #667: explicit `@Inject(MEMBERS_REPO_TOKEN)` is mandatory
 * under tsx + NestJS DI.
 *
 * Spec: `sdd/org-members/spec` R-Jwt-Invalidate-Cross-User
 *   (cache amortization scenario reads via this method).
 * Design: `sdd/org-members/design` §0 #4, §3, §5.
 */
@Injectable()
export class MembersService {
  constructor(@Inject(MEMBERS_REPO_TOKEN) private readonly repo: MembersRepo) {}

  /**
   * Returns the live `User.membershipsVersion` for `userId`.
   *
   * The freshness guard wraps this call in a `(userId, jwtIat)`-keyed
   * 30s cache; this method itself does NOT cache — it issues one
   * SELECT per call (B3 will not change that contract; the cache
   * remains at the guard layer per design §3).
   */
  async getCurrentVersion(userId: string): Promise<number> {
    return this.repo.getUserMembershipsVersion(userId);
  }
}
