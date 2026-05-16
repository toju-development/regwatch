import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@regwatch/db/client';
import type { Role } from '@regwatch/types';
import { PRISMA_CLIENT } from './prisma.token.js';

/**
 * Persistence boundary for the Organizations module.
 *
 * Contract is intentionally narrow — only the queries needed by
 * `OrganizationsService` (`getMe` + `create`). Keeping it small avoids
 * leaking Prisma model surface into the service layer and makes unit
 * tests trivially mockable (no `vitest-mock-extended`).
 *
 * Design: `sdd/org-membership-ux/design` §1 (DI), §2 (contracts).
 * Foot-gun #628: explicit `@Inject(TOKEN)` for tsx + NestJS DI.
 */
export interface OrgRepo {
  /** Returns `Organization.{id, name, slug}` for the given ids (any order). */
  findOrganizationsByIds(ids: string[]): Promise<Array<{ id: string; name: string; slug: string }>>;

  /** Returns the user's `personalOrgId` (nullable) for `isPersonal` derivation. */
  getUserPersonalOrgId(userId: string): Promise<string | null>;

  /**
   * Atomically creates one `Organization` AND one `Membership(role=OWNER)`
   * in a single Prisma `$transaction`. Throws on Prisma `P2002` (unique
   * collision on `slug`); the caller is responsible for retry semantics.
   *
   * Spec: `sdd/org-membership-ux/spec` R-OrgCreate S "Success creates
   * org+membership atomically".
   */
  createOrgWithMembership(args: { userId: string; name: string; slug: string }): Promise<{
    org: { id: string; name: string; slug: string };
    membership: { id: string; userId: string; organizationId: string; role: Role };
  }>;

  /**
   * Updates the display name of an existing organization.
   *
   * Spec: `sdd/onboarding-redesign/spec` R-RenameOrg.
   * Design: `sdd/onboarding-redesign/design` — OrgRepo.updateName.
   */
  updateName(orgId: string, name: string): Promise<{ id: string; name: string }>;
}

/** Injection token for `OrgRepo` — explicit per foot-gun #628. */
export const ORG_REPO_TOKEN = Symbol('ORG_REPO_TOKEN');

/**
 * Prisma-backed implementation of `OrgRepo`.
 *
 * Holds no state of its own — the `PrismaClient` singleton is resolved
 * via DI (`PRISMA_CLIENT` token in `organizations.module.ts`). `org` and
 * `membership` are returned trimmed to the fields the service consumes
 * (`select` for tx safety + payload size).
 */
@Injectable()
export class PrismaOrgRepo implements OrgRepo {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findOrganizationsByIds(
    ids: string[],
  ): Promise<Array<{ id: string; name: string; slug: string }>> {
    if (ids.length === 0) return [];
    return this.prisma.organization.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, slug: true },
    });
  }

  async getUserPersonalOrgId(userId: string): Promise<string | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { personalOrgId: true },
    });
    return row?.personalOrgId ?? null;
  }

  async createOrgWithMembership(args: { userId: string; name: string; slug: string }): Promise<{
    org: { id: string; name: string; slug: string };
    membership: { id: string; userId: string; organizationId: string; role: Role };
  }> {
    const [org, membership] = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: { name: args.name, slug: args.slug },
        select: { id: true, name: true, slug: true },
      });
      const memb = await tx.membership.create({
        data: {
          userId: args.userId,
          organizationId: created.id,
          role: 'OWNER',
        },
        select: { id: true, userId: true, organizationId: true, role: true },
      });
      return [created, memb] as const;
    });
    return { org, membership: { ...membership, role: membership.role as Role } };
  }

  async updateName(orgId: string, name: string): Promise<{ id: string; name: string }> {
    return this.prisma.organization.update({
      where: { id: orgId },
      data: { name },
      select: { id: true, name: true },
    });
  }
}
