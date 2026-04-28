import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@regwatch/db/client';
import type { AuthUser, MembershipClaim, Role } from '@regwatch/types';
import { MembersService, MEMBERS_ERROR_CODES } from './members.service.js';
import { PrismaMembersRepo, type MembersRepo } from './members.repo.js';

/**
 * `MembersService` test surface across B2 + B3.
 *
 * **B2 — `getCurrentVersion`**: pure delegation to the repo, no DB.
 *
 * **B3 — `updateRole` + `remove`**: invariant chain (last-OWNER,
 * personalOrg, self-promote, ADMIN-vs-OWNER) AND atomic
 * `User.membershipsVersion` bump inside `prisma.$transaction(...)`.
 *
 * The invariant tests run with a mock `MembersRepo` and a stub
 * `prisma.$transaction` — sufficient to assert the decision tree and
 * the in-tx `bumpUserVersion` call site.
 *
 * The atomicity tests run against a real Postgres (skip-if-unavailable
 * — same harness as `organizations.integration.spec.ts`) so the
 * `Prisma.$transaction` rollback semantics are exercised by the engine,
 * not a stub. These are what prove R-User-Memberships-Version "Rollback
 * rolls back the version bump".
 *
 * Spec: `sdd/org-members/spec` R-Membership-Update, R-Membership-Remove,
 *   R-User-Memberships-Version, R-Members-List.
 * Design: `sdd/org-members/design` §0 #6, §2 (service order), §5 (DI).
 */

// -------------------------------------------------------------------- //
// Mock harness                                                         //
// -------------------------------------------------------------------- //

function makeRepo(): MembersRepo {
  return {
    getUserMembershipsVersion: vi.fn(),
    findInOrg: vi.fn(),
    findUserPersonalOrgId: vi.fn(),
    countOwners: vi.fn(),
    updateMembershipRole: vi.fn(),
    deleteMembership: vi.fn(),
    bumpUserVersion: vi.fn(),
    listByOrg: vi.fn(),
  };
}

/**
 * Stub `PrismaClient` whose `$transaction` immediately invokes the
 * callback with a sentinel `tx` object — the mock repo accepts any
 * value as the `tx` arg, so we just need a stable reference to assert
 * "the bump ran on the same tx as the write".
 */
const FAKE_TX = Symbol('fake-tx');
function makePrismaStub(): { client: PrismaClient; tx: typeof FAKE_TX } {
  const client = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(FAKE_TX)),
  };
  return { client: client as unknown as PrismaClient, tx: FAKE_TX };
}

function actor(opts: { userId?: string; orgId: string; role: Role; email?: string }): AuthUser {
  const claim: MembershipClaim = {
    organizationId: opts.orgId,
    orgSlug: 'slug',
    role: opts.role,
  };
  return {
    userId: opts.userId ?? 'actor',
    email: opts.email ?? 'actor@test.local',
    memberships: [claim],
  };
}

// -------------------------------------------------------------------- //
// B2 — getCurrentVersion (kept)                                        //
// -------------------------------------------------------------------- //

describe('MembersService.getCurrentVersion', () => {
  let repo: MembersRepo;
  let svc: MembersService;

  beforeEach(() => {
    repo = makeRepo();
    const { client } = makePrismaStub();
    svc = new MembersService(repo, client);
  });

  it('delegates to repo.getUserMembershipsVersion and returns the value verbatim', async () => {
    vi.mocked(repo.getUserMembershipsVersion).mockResolvedValue(7);
    const result = await svc.getCurrentVersion('user-1');
    expect(result).toBe(7);
    expect(repo.getUserMembershipsVersion).toHaveBeenCalledTimes(1);
    expect(repo.getUserMembershipsVersion).toHaveBeenCalledWith('user-1');
  });

  it('does not memoize — every call reaches the repo (cache lives at the guard layer)', async () => {
    vi.mocked(repo.getUserMembershipsVersion).mockResolvedValueOnce(3).mockResolvedValueOnce(4);
    const a = await svc.getCurrentVersion('user-1');
    const b = await svc.getCurrentVersion('user-1');
    expect([a, b]).toEqual([3, 4]);
    expect(repo.getUserMembershipsVersion).toHaveBeenCalledTimes(2);
  });

  it('propagates repo rejections unchanged', async () => {
    const boom = new Error('db dead');
    vi.mocked(repo.getUserMembershipsVersion).mockRejectedValue(boom);
    await expect(svc.getCurrentVersion('user-1')).rejects.toBe(boom);
  });
});

// -------------------------------------------------------------------- //
// B3 — updateRole invariants (mock harness)                            //
// -------------------------------------------------------------------- //

describe('MembersService.updateRole — invariants (mock harness)', () => {
  let repo: MembersRepo;
  let svc: MembersService;
  let prismaStub: ReturnType<typeof makePrismaStub>;

  beforeEach(() => {
    repo = makeRepo();
    prismaStub = makePrismaStub();
    svc = new MembersService(repo, prismaStub.client);
  });

  it('404 MEMBERSHIP_NOT_FOUND when target has no membership in :orgId', async () => {
    vi.mocked(repo.findInOrg).mockResolvedValue(null);

    const a = actor({ userId: 'A', orgId: 'O', role: 'OWNER' });
    await expect(svc.updateRole(a, 'O', 'B', 'VIEWER')).rejects.toMatchObject({
      status: 404,
      response: { code: MEMBERS_ERROR_CODES.MEMBERSHIP_NOT_FOUND },
    });
    // No write, no bump.
    expect(repo.updateMembershipRole).not.toHaveBeenCalled();
    expect(repo.bumpUserVersion).not.toHaveBeenCalled();
  });

  it('S "Self-promote rejected" — ADMIN cannot self-promote to OWNER (403 SELF_PROMOTE_FORBIDDEN)', async () => {
    vi.mocked(repo.findInOrg).mockResolvedValue({
      id: 'm-A',
      userId: 'A',
      organizationId: 'O',
      role: 'ADMIN',
    });

    const a = actor({ userId: 'A', orgId: 'O', role: 'ADMIN' });
    await expect(svc.updateRole(a, 'O', 'A', 'OWNER')).rejects.toMatchObject({
      status: 403,
      response: { code: MEMBERS_ERROR_CODES.SELF_PROMOTE_FORBIDDEN },
    });
    expect(repo.updateMembershipRole).not.toHaveBeenCalled();
    expect(repo.bumpUserVersion).not.toHaveBeenCalled();
  });

  it('S "Self-downgrade allowed" — OWNER → ANALYST (when another OWNER exists)', async () => {
    vi.mocked(repo.findInOrg).mockResolvedValue({
      id: 'm-A',
      userId: 'A',
      organizationId: 'O',
      role: 'OWNER',
    });
    vi.mocked(repo.countOwners).mockResolvedValue(2); // not last OWNER

    const a = actor({ userId: 'A', orgId: 'O', role: 'OWNER' });
    await svc.updateRole(a, 'O', 'A', 'ANALYST');

    expect(repo.updateMembershipRole).toHaveBeenCalledTimes(1);
    expect(repo.updateMembershipRole).toHaveBeenCalledWith(FAKE_TX, 'm-A', 'ANALYST');
    expect(repo.bumpUserVersion).toHaveBeenCalledTimes(1);
    expect(repo.bumpUserVersion).toHaveBeenCalledWith(FAKE_TX, 'A');
  });

  it('S "ADMIN cannot promote to OWNER" — cross-user ADMIN→OWNER (403 OWNER_PROMOTE_REQUIRES_OWNER)', async () => {
    vi.mocked(repo.findInOrg).mockResolvedValue({
      id: 'm-B',
      userId: 'B',
      organizationId: 'O',
      role: 'ANALYST',
    });

    const a = actor({ userId: 'A', orgId: 'O', role: 'ADMIN' });
    await expect(svc.updateRole(a, 'O', 'B', 'OWNER')).rejects.toMatchObject({
      status: 403,
      response: { code: MEMBERS_ERROR_CODES.OWNER_PROMOTE_REQUIRES_OWNER },
    });
    expect(repo.updateMembershipRole).not.toHaveBeenCalled();
    expect(repo.bumpUserVersion).not.toHaveBeenCalled();
  });

  it('OWNER may promote ANALYST → OWNER (cross-user, allowed)', async () => {
    vi.mocked(repo.findInOrg).mockResolvedValue({
      id: 'm-B',
      userId: 'B',
      organizationId: 'O',
      role: 'ANALYST',
    });

    const a = actor({ userId: 'A', orgId: 'O', role: 'OWNER' });
    await svc.updateRole(a, 'O', 'B', 'OWNER');

    expect(repo.updateMembershipRole).toHaveBeenCalledTimes(1);
    expect(repo.updateMembershipRole).toHaveBeenCalledWith(FAKE_TX, 'm-B', 'OWNER');
    expect(repo.bumpUserVersion).toHaveBeenCalledTimes(1);
    expect(repo.bumpUserVersion).toHaveBeenCalledWith(FAKE_TX, 'B'); // Promote → OWNER does NOT trigger last-OWNER count (target.role !== OWNER).
    expect(repo.countOwners).not.toHaveBeenCalled();
  });

  it('S "Last-OWNER demote → 409" — sole OWNER demoting self is blocked', async () => {
    vi.mocked(repo.findInOrg).mockResolvedValue({
      id: 'm-A',
      userId: 'A',
      organizationId: 'O',
      role: 'OWNER',
    });
    vi.mocked(repo.countOwners).mockResolvedValue(1);

    const a = actor({ userId: 'A', orgId: 'O', role: 'OWNER' });
    await expect(svc.updateRole(a, 'O', 'A', 'ADMIN')).rejects.toMatchObject({
      status: 409,
      response: { code: MEMBERS_ERROR_CODES.LAST_OWNER },
    });
    expect(repo.updateMembershipRole).not.toHaveBeenCalled();
    expect(repo.bumpUserVersion).not.toHaveBeenCalled();
  });

  it('S "OWNER demotes another member" — OWNER → VIEWER, version bumps for target only', async () => {
    vi.mocked(repo.findInOrg).mockResolvedValue({
      id: 'm-B',
      userId: 'B',
      organizationId: 'O',
      role: 'ADMIN',
    });

    const a = actor({ userId: 'A', orgId: 'O', role: 'OWNER' });
    await svc.updateRole(a, 'O', 'B', 'VIEWER');

    expect(repo.updateMembershipRole).toHaveBeenCalledTimes(1);
    expect(repo.updateMembershipRole).toHaveBeenCalledWith(FAKE_TX, 'm-B', 'VIEWER'); // Crucially: bump for the *target* user (B), not the actor (A).
    expect(repo.bumpUserVersion).toHaveBeenCalledTimes(1);
    expect(repo.bumpUserVersion).toHaveBeenCalledWith(FAKE_TX, 'B');
  });

  it('write + bump share the same `tx` (same $transaction callback)', async () => {
    vi.mocked(repo.findInOrg).mockResolvedValue({
      id: 'm-B',
      userId: 'B',
      organizationId: 'O',
      role: 'ADMIN',
    });

    const a = actor({ userId: 'A', orgId: 'O', role: 'OWNER' });
    await svc.updateRole(a, 'O', 'B', 'VIEWER');

    // Both calls must have received the SAME tx sentinel — proves no
    // accidental fall-through to `this.prisma` (foot-gun #645).
    const writeTx = vi.mocked(repo.updateMembershipRole).mock.calls[0]?.[0];
    const bumpTx = vi.mocked(repo.bumpUserVersion).mock.calls[0]?.[0];
    expect(writeTx).toBe(FAKE_TX);
    expect(bumpTx).toBe(FAKE_TX);
    expect(prismaStub.client.$transaction).toHaveBeenCalledOnce();
  });
});

// -------------------------------------------------------------------- //
// B3 — remove invariants (mock harness)                                //
// -------------------------------------------------------------------- //

describe('MembersService.remove — invariants (mock harness)', () => {
  let repo: MembersRepo;
  let svc: MembersService;

  beforeEach(() => {
    repo = makeRepo();
    const { client } = makePrismaStub();
    svc = new MembersService(repo, client);
  });

  it('404 MEMBERSHIP_NOT_FOUND when target has no membership in :orgId', async () => {
    vi.mocked(repo.findInOrg).mockResolvedValue(null);
    const a = actor({ userId: 'A', orgId: 'O', role: 'OWNER' });
    await expect(svc.remove(a, 'O', 'B')).rejects.toMatchObject({
      status: 404,
      response: { code: MEMBERS_ERROR_CODES.MEMBERSHIP_NOT_FOUND },
    });
    expect(repo.deleteMembership).not.toHaveBeenCalled();
    expect(repo.bumpUserVersion).not.toHaveBeenCalled();
  });

  it('S "Self-leave on personalOrg → 400 PERSONAL_ORG_UNREMOVABLE"', async () => {
    vi.mocked(repo.findInOrg).mockResolvedValue({
      id: 'm-A',
      userId: 'A',
      organizationId: 'O',
      role: 'OWNER',
    });
    vi.mocked(repo.findUserPersonalOrgId).mockResolvedValue('O'); // personal === target org

    const a = actor({ userId: 'A', orgId: 'O', role: 'OWNER' });
    await expect(svc.remove(a, 'O', 'A')).rejects.toMatchObject({
      status: 400,
      response: { code: MEMBERS_ERROR_CODES.PERSONAL_ORG_UNREMOVABLE },
    });
    expect(repo.deleteMembership).not.toHaveBeenCalled();
    expect(repo.bumpUserVersion).not.toHaveBeenCalled();
  });

  it('S "ADMIN removes OWNER → 403 OWNER_REMOVE_REQUIRES_OWNER"', async () => {
    vi.mocked(repo.findInOrg).mockResolvedValue({
      id: 'm-B',
      userId: 'B',
      organizationId: 'O',
      role: 'OWNER',
    });
    vi.mocked(repo.findUserPersonalOrgId).mockResolvedValue(null);

    const a = actor({ userId: 'A', orgId: 'O', role: 'ADMIN' });
    await expect(svc.remove(a, 'O', 'B')).rejects.toMatchObject({
      status: 403,
      response: { code: MEMBERS_ERROR_CODES.OWNER_REMOVE_REQUIRES_OWNER },
    });
    expect(repo.deleteMembership).not.toHaveBeenCalled();
    expect(repo.bumpUserVersion).not.toHaveBeenCalled();
  });

  it('S "Last-OWNER remove → 409 LAST_OWNER" — sole OWNER cannot self-leave a non-personal org either', async () => {
    vi.mocked(repo.findInOrg).mockResolvedValue({
      id: 'm-A',
      userId: 'A',
      organizationId: 'O',
      role: 'OWNER',
    });
    vi.mocked(repo.findUserPersonalOrgId).mockResolvedValue(null); // O is NOT personal
    vi.mocked(repo.countOwners).mockResolvedValue(1);

    const a = actor({ userId: 'A', orgId: 'O', role: 'OWNER' });
    await expect(svc.remove(a, 'O', 'A')).rejects.toMatchObject({
      status: 409,
      response: { code: MEMBERS_ERROR_CODES.LAST_OWNER },
    });
    expect(repo.deleteMembership).not.toHaveBeenCalled();
    expect(repo.bumpUserVersion).not.toHaveBeenCalled();
  });

  it('S "Self-leave (non-personal org) allowed" — ADMIN leaves freely; bump fires for the target', async () => {
    vi.mocked(repo.findInOrg).mockResolvedValue({
      id: 'm-B',
      userId: 'B',
      organizationId: 'O',
      role: 'ADMIN',
    });
    vi.mocked(repo.findUserPersonalOrgId).mockResolvedValue(null);

    const a = actor({ userId: 'B', orgId: 'O', role: 'ADMIN' });
    await svc.remove(a, 'O', 'B');

    expect(repo.deleteMembership).toHaveBeenCalledTimes(1);
    expect(repo.deleteMembership).toHaveBeenCalledWith(FAKE_TX, 'm-B');
    expect(repo.bumpUserVersion).toHaveBeenCalledTimes(1);
    expect(repo.bumpUserVersion).toHaveBeenCalledWith(FAKE_TX, 'B'); // Non-OWNER target → no last-OWNER count needed.
    expect(repo.countOwners).not.toHaveBeenCalled();
  });

  it('S "OWNER removes another member" — OWNER kicks ADMIN, bump fires for kicked user', async () => {
    vi.mocked(repo.findInOrg).mockResolvedValue({
      id: 'm-B',
      userId: 'B',
      organizationId: 'O',
      role: 'ADMIN',
    });
    vi.mocked(repo.findUserPersonalOrgId).mockResolvedValue(null);

    const a = actor({ userId: 'A', orgId: 'O', role: 'OWNER' });
    await svc.remove(a, 'O', 'B');

    expect(repo.deleteMembership).toHaveBeenCalledTimes(1);
    expect(repo.deleteMembership).toHaveBeenCalledWith(FAKE_TX, 'm-B');
    expect(repo.bumpUserVersion).toHaveBeenCalledTimes(1);
    expect(repo.bumpUserVersion).toHaveBeenCalledWith(FAKE_TX, 'B');
  });

  it('OWNER removes another OWNER (non-last) — last-OWNER count consulted, allowed when 2+ owners', async () => {
    vi.mocked(repo.findInOrg).mockResolvedValue({
      id: 'm-B',
      userId: 'B',
      organizationId: 'O',
      role: 'OWNER',
    });
    vi.mocked(repo.findUserPersonalOrgId).mockResolvedValue(null);
    vi.mocked(repo.countOwners).mockResolvedValue(2);

    const a = actor({ userId: 'A', orgId: 'O', role: 'OWNER' });
    await svc.remove(a, 'O', 'B');

    expect(repo.deleteMembership).toHaveBeenCalledTimes(1);
    expect(repo.deleteMembership).toHaveBeenCalledWith(FAKE_TX, 'm-B');
    expect(repo.bumpUserVersion).toHaveBeenCalledTimes(1);
    expect(repo.bumpUserVersion).toHaveBeenCalledWith(FAKE_TX, 'B');
    expect(repo.countOwners).toHaveBeenCalledTimes(1);
    expect(repo.countOwners).toHaveBeenCalledWith(FAKE_TX, 'O');
  });
});

// -------------------------------------------------------------------- //
// B3 — atomicity against real Postgres (skip-if-unavailable)           //
// -------------------------------------------------------------------- //

const PLACEHOLDER_DB_URL = 'postgresql://test:test@localhost:5432/test';
if (!process.env.DATABASE_URL || process.env.DATABASE_URL === PLACEHOLDER_DB_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:root@localhost:5432/regwatch_dev?schema=public';
}

const probe = new PrismaClient();
let dbAvailable = false;
try {
  await probe.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
} finally {
  await probe.$disconnect();
}

describe.skipIf(!dbAvailable)(
  'MembersService — atomicity & cross-user mv isolation (real Postgres)',
  () => {
    let prisma: PrismaClient;
    let repo: PrismaMembersRepo;
    let svc: MembersService;

    const createdUserIds = new Set<string>();
    const createdOrgIds = new Set<string>();

    beforeAll(() => {
      prisma = new PrismaClient();
      repo = new PrismaMembersRepo(prisma);
      svc = new MembersService(repo, prisma);
    });

    afterAll(async () => {
      if (createdUserIds.size > 0) {
        await prisma.membership.deleteMany({
          where: { userId: { in: [...createdUserIds] } },
        });
      }
      if (createdOrgIds.size > 0) {
        await prisma.organization.deleteMany({
          where: { id: { in: [...createdOrgIds] } },
        });
      }
      if (createdUserIds.size > 0) {
        await prisma.user.deleteMany({ where: { id: { in: [...createdUserIds] } } });
      }
      await prisma.$disconnect();
    });

    /**
     * Seed a fresh org with N users; users 0..N-1 get roles per `roles[i]`.
     * Sets `personalOrgId` for `personalUserIndex` to the *new* org so the
     * personal-org-unremovable scenario fires. Returns the ids needed by
     * each test.
     */
    async function seedOrgWithUsers(opts: {
      roles: Role[];
      personalUserIndex?: number | null;
    }): Promise<{ orgId: string; userIds: string[] }> {
      const tag = randomBytes(6).toString('hex');
      const org = await prisma.organization.create({
        data: { slug: `mem-${tag}`, name: `Org ${tag}` },
        select: { id: true },
      });
      createdOrgIds.add(org.id);

      const userIds: string[] = [];
      for (let i = 0; i < opts.roles.length; i += 1) {
        const id = `mem-${tag}-${i}`;
        await prisma.user.create({ data: { id, email: `${id}@test.local` } });
        createdUserIds.add(id);
        await prisma.membership.create({
          data: { userId: id, organizationId: org.id, role: opts.roles[i] as Role },
        });
        userIds.push(id);
      }
      if (opts.personalUserIndex !== null && opts.personalUserIndex !== undefined) {
        const personalId = userIds[opts.personalUserIndex];
        if (!personalId) throw new Error('personalUserIndex out of range');
        await prisma.user.update({
          where: { id: personalId },
          data: { personalOrgId: org.id },
        });
      }
      return { orgId: org.id, userIds };
    }

    it('R-User-Memberships-Version "UPDATE bumps version atomically" — single increment for target only', async () => {
      const { orgId, userIds } = await seedOrgWithUsers({
        roles: ['OWNER', 'ADMIN'],
      });
      const [aId, bId] = userIds;
      if (!aId || !bId) throw new Error('seed shape');
      const before = await Promise.all([
        repo.getUserMembershipsVersion(aId),
        repo.getUserMembershipsVersion(bId),
      ]);

      const ownerA: AuthUser = {
        userId: aId,
        email: `${aId}@test.local`,
        memberships: [{ organizationId: orgId, orgSlug: 's', role: 'OWNER' }],
      };
      await svc.updateRole(ownerA, orgId, bId, 'VIEWER');

      const after = await Promise.all([
        repo.getUserMembershipsVersion(aId),
        repo.getUserMembershipsVersion(bId),
      ]);
      // Target B bumped exactly once; actor A untouched (cross-user mv isolation).
      expect((after[0] ?? 0) - (before[0] ?? 0)).toBe(0);
      expect((after[1] ?? 0) - (before[1] ?? 0)).toBe(1);

      const updated = await prisma.membership.findUnique({
        where: { userId_organizationId: { userId: bId, organizationId: orgId } },
        select: { role: true },
      });
      expect(updated?.role).toBe('VIEWER');
    });

    it('R-User-Memberships-Version "DELETE bumps version atomically"', async () => {
      const { orgId, userIds } = await seedOrgWithUsers({
        roles: ['OWNER', 'ADMIN'],
      });
      const [aId, bId] = userIds;
      if (!aId || !bId) throw new Error('seed shape');
      const beforeB = await repo.getUserMembershipsVersion(bId);

      const ownerA: AuthUser = {
        userId: aId,
        email: `${aId}@test.local`,
        memberships: [{ organizationId: orgId, orgSlug: 's', role: 'OWNER' }],
      };
      await svc.remove(ownerA, orgId, bId);

      const afterB = await repo.getUserMembershipsVersion(bId);
      expect(afterB - beforeB).toBe(1);
      const gone = await prisma.membership.findUnique({
        where: { userId_organizationId: { userId: bId, organizationId: orgId } },
      });
      expect(gone).toBeNull();
    });

    it('R-User-Memberships-Version "Rollback rolls back the version bump" — failing repo call leaves both unchanged', async () => {
      const { orgId, userIds } = await seedOrgWithUsers({
        roles: ['OWNER', 'ADMIN'],
      });
      const [aId, bId] = userIds;
      if (!aId || !bId) throw new Error('seed shape');
      const before = await Promise.all([
        repo.getUserMembershipsVersion(bId),
        prisma.membership.findUniqueOrThrow({
          where: { userId_organizationId: { userId: bId, organizationId: orgId } },
          select: { role: true },
        }),
      ]);

      // Wrap repo to throw AFTER the role write but BEFORE the bump —
      // proves the entire tx rolls back, NOT just the bump.
      const sabotageRepo = new PrismaMembersRepo(prisma);
      let bumpHasRun = false;
      sabotageRepo.bumpUserVersion = vi.fn(async () => {
        bumpHasRun = true;
        throw new Error('boom — simulating mid-tx failure');
      });
      const sabotageSvc = new MembersService(sabotageRepo, prisma);

      const ownerA: AuthUser = {
        userId: aId,
        email: `${aId}@test.local`,
        memberships: [{ organizationId: orgId, orgSlug: 's', role: 'OWNER' }],
      };
      await expect(sabotageSvc.updateRole(ownerA, orgId, bId, 'VIEWER')).rejects.toThrow(/boom/);

      // Both reads observe the pre-tx state — Prisma rolled the role
      // write back together with the would-be bump.
      const after = await Promise.all([
        repo.getUserMembershipsVersion(bId),
        prisma.membership.findUniqueOrThrow({
          where: { userId_organizationId: { userId: bId, organizationId: orgId } },
          select: { role: true },
        }),
      ]);
      expect(after[0]).toBe(before[0]);
      expect(after[1].role).toBe(before[1].role);
      expect(bumpHasRun).toBe(true);
    });

    it('S "Last-OWNER remove → 409" — real DB enforces and leaves Membership intact, mv unbumped', async () => {
      const { orgId, userIds } = await seedOrgWithUsers({ roles: ['OWNER'] });
      const [aId] = userIds;
      if (!aId) throw new Error('seed shape');
      const beforeMv = await repo.getUserMembershipsVersion(aId);

      const ownerA: AuthUser = {
        userId: aId,
        email: `${aId}@test.local`,
        memberships: [{ organizationId: orgId, orgSlug: 's', role: 'OWNER' }],
      };
      await expect(svc.remove(ownerA, orgId, aId)).rejects.toMatchObject({
        status: 409,
        response: { code: MEMBERS_ERROR_CODES.LAST_OWNER },
      });

      const stillThere = await prisma.membership.findUnique({
        where: { userId_organizationId: { userId: aId, organizationId: orgId } },
      });
      expect(stillThere).not.toBeNull();
      const afterMv = await repo.getUserMembershipsVersion(aId);
      expect(afterMv).toBe(beforeMv);
    });

    it('R-Members-List "ordered by joinedAt ASC" with isPersonalOrgOwner derived from User.personalOrgId', async () => {
      const { orgId, userIds } = await seedOrgWithUsers({
        roles: ['OWNER', 'ADMIN', 'VIEWER'],
        personalUserIndex: 1,
      });

      const list = await svc.list(orgId);
      expect(list).toHaveLength(3);
      expect(list.map((m) => m.userId)).toEqual(userIds); // creation order = joinedAt ASC
      expect(list.map((m) => m.role)).toEqual(['OWNER', 'ADMIN', 'VIEWER']);
      // Only index 1 had personalOrgId set to this org.
      expect(list.map((m) => m.isPersonalOrgOwner)).toEqual([false, true, false]);
      for (const row of list) {
        expect(row.email).toMatch(/@test\.local$/);
        expect(row.joinedAt).toBeInstanceOf(Date);
      }
    });
  },
);
