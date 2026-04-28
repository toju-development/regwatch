import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@regwatch/db/client';
import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';
import { MEMBERS_REPO_TOKEN } from './tokens.js';

/**
 * Persistence boundary for the members module.
 *
 * B2 scope (this batch) — single read needed by `MembershipFreshnessGuard`:
 *   - {@link MembersRepo.getUserMembershipsVersion}
 *
 * B3 will extend this contract with `findInOrg`, `listByOrg`, and the
 * transactional helpers (`updateRole`, `remove`) that participate in
 * `MembersService.mutate()`'s `prisma.$transaction(...)` callback.
 *
 * Design: `sdd/org-members/design` §1, §5 (DI), §3 (guard consumer).
 */
export interface MembersRepo {
  /**
   * Returns the live `User.membershipsVersion` for `userId` — 0 when the
   * row is missing (defensive; the column is NOT NULL with a default of
   * 0 since migration `add_user_memberships_version`, B1 / commit
   * `e00bbbd`, so this fallback only matters if the user row was
   * deleted between JWT issue and the freshness check).
   */
  getUserMembershipsVersion(userId: string): Promise<number>;
}

/**
 * Prisma-backed implementation of {@link MembersRepo}.
 *
 * Holds no state of its own — the `PrismaClient` singleton is resolved
 * via DI (`PRISMA_CLIENT` token, provided by the global `PrismaModule`).
 *
 * Foot-gun #628/#667: explicit `@Inject(PRISMA_CLIENT)` is mandatory
 * under tsx + NestJS DI.
 */
@Injectable()
export class PrismaMembersRepo implements MembersRepo {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async getUserMembershipsVersion(userId: string): Promise<number> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { membershipsVersion: true },
    });
    return row?.membershipsVersion ?? 0;
  }
}

// Re-export for convenience so importers don't have to round-trip via
// `tokens.js` for the sole token they care about at this layer.
export { MEMBERS_REPO_TOKEN };
