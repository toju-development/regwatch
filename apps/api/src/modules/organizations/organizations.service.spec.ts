import 'reflect-metadata';
import { InternalServerErrorException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@regwatch/types';
import { OrganizationsService, SLUG_RETRY_MAX } from './organizations.service.js';
import type { OrgRepo } from './org.repo.js';

/**
 * Spec coverage matrix (`sdd/org-membership-ux/spec`):
 *
 *   R-OrgCreate
 *     S "Success creates org+membership atomically"  → create.success
 *     S "Transaction rollback on membership failure" → create.repoThrowsNonP2002
 *     S "Concurrent creates by same user"            → integration (B2)
 *     S "Unauthenticated → 401"                      → integration (B2)
 *     + slug retry on P2002                          → create.slugRetry / create.slugExhaust
 *     + DTO validation (oversize)                    → create-org.dto.spec.ts (deferred)
 *
 *   R-Org-GetMe
 *     S "Single personal membership"                 → getMe.singlePersonal
 *     S "Three memberships, cookie set"              → getMe.multiWithXOrgId
 *     S "Unauthenticated → 401"                      → controller-level / integration (B2)
 *     + activeOrgId mirrors X-Org-Id only when valid → getMe.invalidXOrgId
 *
 * Design `sdd/org-membership-ux/design` §2: API does NOT auto-pick the
 * active org — it echoes `X-Org-Id` if valid, else returns `null`. The
 * spec scenario "no cookie → activeOrgId === memberships[0].orgId" is
 * fulfilled at the SYSTEM level by `apps/web` calling `ensureActiveOrg`
 * BEFORE the `/me` request. This unit test asserts the API contract
 * (echo only); web auto-pick is covered in B3 + B5 + E2E.
 */

const ROLE_OWNER: Role = 'OWNER';

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    userId: 'user-1',
    email: 'a@b.com',
    memberships: [{ organizationId: 'org-personal', orgSlug: 'personal-slug', role: ROLE_OWNER }],
    ...overrides,
  };
}

function makeRepo(): OrgRepo {
  return {
    findOrganizationsByIds: vi.fn(),
    getUserPersonalOrgId: vi.fn(),
    createOrgWithMembership: vi.fn(),
    updateName: vi.fn(),
  };
}

describe('OrganizationsService.getMe', () => {
  let repo: OrgRepo;

  beforeEach(() => {
    repo = makeRepo();
  });

  it('returns 1 membership marked isPersonal=true; activeOrgId=null when X-Org-Id absent (R-Org-GetMe S1, design §2 echo-only)', async () => {
    vi.mocked(repo.findOrganizationsByIds).mockResolvedValue([
      { id: 'org-personal', name: 'Personal Workspace', slug: 'personal-slug' },
    ]);
    vi.mocked(repo.getUserPersonalOrgId).mockResolvedValue('org-personal');

    const service = new OrganizationsService(repo, () => 'unused');
    const result = await service.getMe(makeUser(), null);

    expect(result.memberships).toHaveLength(1);
    expect(result.memberships[0]).toEqual({
      orgId: 'org-personal',
      orgSlug: 'personal-slug',
      orgName: 'Personal Workspace',
      role: 'OWNER',
      isPersonal: true,
    });
    expect(result.activeOrgId).toBeNull();
  });

  it('echoes X-Org-Id as activeOrgId when valid; isPersonal derived per-membership (R-Org-GetMe S2)', async () => {
    const user = makeUser({
      memberships: [
        { organizationId: 'org-1', orgSlug: 'one', role: 'OWNER' },
        { organizationId: 'org-2', orgSlug: 'two', role: 'ADMIN' },
        { organizationId: 'org-3', orgSlug: 'three', role: 'VIEWER' },
      ],
    });
    vi.mocked(repo.findOrganizationsByIds).mockResolvedValue([
      { id: 'org-1', name: 'One', slug: 'one' },
      { id: 'org-2', name: 'Two', slug: 'two' },
      { id: 'org-3', name: 'Three', slug: 'three' },
    ]);
    vi.mocked(repo.getUserPersonalOrgId).mockResolvedValue('org-2');

    const service = new OrganizationsService(repo, () => 'unused');
    const result = await service.getMe(user, 'org-2');

    expect(result.activeOrgId).toBe('org-2');
    expect(result.memberships.map((m) => m.isPersonal)).toEqual([false, true, false]);
    expect(result.memberships.map((m) => m.orgName)).toEqual(['One', 'Two', 'Three']);
  });

  it('returns activeOrgId=null when X-Org-Id is set but not in memberships (defensive)', async () => {
    vi.mocked(repo.findOrganizationsByIds).mockResolvedValue([
      { id: 'org-personal', name: 'Personal', slug: 'personal-slug' },
    ]);
    vi.mocked(repo.getUserPersonalOrgId).mockResolvedValue('org-personal');

    const service = new OrganizationsService(repo, () => 'unused');
    const result = await service.getMe(makeUser(), 'org-stranger');

    expect(result.activeOrgId).toBeNull();
  });

  it('falls back to orgSlug when an organization row is missing (defense vs orphaned JWT membership)', async () => {
    vi.mocked(repo.findOrganizationsByIds).mockResolvedValue([]); // org row deleted
    vi.mocked(repo.getUserPersonalOrgId).mockResolvedValue(null);

    const service = new OrganizationsService(repo, () => 'unused');
    const result = await service.getMe(makeUser(), null);

    expect(result.memberships[0]?.orgName).toBe('personal-slug');
    expect(result.memberships[0]?.isPersonal).toBe(false);
  });

  it('marks isPersonal=false for every membership when User.personalOrgId is null', async () => {
    vi.mocked(repo.findOrganizationsByIds).mockResolvedValue([
      { id: 'org-personal', name: 'Personal', slug: 'personal-slug' },
    ]);
    vi.mocked(repo.getUserPersonalOrgId).mockResolvedValue(null);

    const service = new OrganizationsService(repo, () => 'unused');
    const result = await service.getMe(makeUser(), null);

    expect(result.memberships[0]?.isPersonal).toBe(false);
  });
});

describe('OrganizationsService.create', () => {
  let repo: OrgRepo;

  beforeEach(() => {
    repo = makeRepo();
  });

  it('creates org+membership atomically and returns {id,name,slug} (R-OrgCreate S1)', async () => {
    vi.mocked(repo.createOrgWithMembership).mockResolvedValue({
      org: { id: 'org-new', name: 'Acme', slug: 'abc123' },
      membership: {
        id: 'm-1',
        userId: 'user-1',
        organizationId: 'org-new',
        role: ROLE_OWNER,
      },
    });

    const service = new OrganizationsService(repo, () => 'abc123');
    const result = await service.create('user-1', 'Acme');

    expect(result).toEqual({ id: 'org-new', name: 'Acme', slug: 'abc123' });
    expect(repo.createOrgWithMembership).toHaveBeenCalledTimes(1);
    expect(repo.createOrgWithMembership).toHaveBeenCalledWith({
      userId: 'user-1',
      name: 'Acme',
      slug: 'abc123',
    });
  });

  it('retries on slug P2002 collision and succeeds with a fresh slug (slug retry — design §2)', async () => {
    const slugs = ['slug-a', 'slug-b', 'slug-c'];
    let i = 0;
    const slugGen = (): string => slugs[i++] ?? 'fallback';

    vi.mocked(repo.createOrgWithMembership)
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValueOnce({
        org: { id: 'org-new', name: 'Acme', slug: 'slug-c' },
        membership: {
          id: 'm-1',
          userId: 'user-1',
          organizationId: 'org-new',
          role: ROLE_OWNER,
        },
      });

    const service = new OrganizationsService(repo, slugGen);
    const result = await service.create('user-1', 'Acme');

    expect(result.slug).toBe('slug-c');
    expect(repo.createOrgWithMembership).toHaveBeenCalledTimes(3);
    expect(vi.mocked(repo.createOrgWithMembership).mock.calls.map((c) => c[0].slug)).toEqual(slugs);
  });

  it('throws InternalServerErrorException after SLUG_RETRY_MAX exhausted P2002 attempts', async () => {
    vi.mocked(repo.createOrgWithMembership).mockRejectedValue({ code: 'P2002' });

    const service = new OrganizationsService(repo, () => 'always-collides');

    await expect(service.create('user-1', 'Acme')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(repo.createOrgWithMembership).toHaveBeenCalledTimes(SLUG_RETRY_MAX);
  });

  it('propagates non-P2002 errors unchanged (R-OrgCreate S2 — tx rollback surfaces 500)', async () => {
    const dbBoom = new Error('connection lost mid-transaction');
    vi.mocked(repo.createOrgWithMembership).mockRejectedValue(dbBoom);

    const service = new OrganizationsService(repo, () => 'slug-x');

    await expect(service.create('user-1', 'Acme')).rejects.toBe(dbBoom);
    expect(repo.createOrgWithMembership).toHaveBeenCalledTimes(1); // no retry
  });

  it('passes the trimmed name straight through to the repo', async () => {
    vi.mocked(repo.createOrgWithMembership).mockResolvedValue({
      org: { id: 'org-new', name: 'Acme', slug: 'slug-x' },
      membership: {
        id: 'm-1',
        userId: 'user-1',
        organizationId: 'org-new',
        role: ROLE_OWNER,
      },
    });

    const service = new OrganizationsService(repo, () => 'slug-x');
    await service.create('user-1', 'Acme');

    expect(vi.mocked(repo.createOrgWithMembership).mock.calls[0]?.[0].name).toBe('Acme');
  });
});

describe('OrganizationsService.rename', () => {
  let repo: OrgRepo;

  beforeEach(() => {
    repo = makeRepo();
  });

  it('delegates to repo.updateName and returns the result (R-RenameOrg S success)', async () => {
    vi.mocked(repo.updateName).mockResolvedValue({ id: 'org-1', name: 'Nueva Org' });
    const service = new OrganizationsService(repo);
    const result = await service.rename('org-1', 'Nueva Org');
    expect(vi.mocked(repo.updateName)).toHaveBeenCalledWith('org-1', 'Nueva Org');
    expect(result).toEqual({ id: 'org-1', name: 'Nueva Org' });
  });

  it('propagates errors from repo.updateName', async () => {
    vi.mocked(repo.updateName).mockRejectedValue(new Error('DB error'));
    const service = new OrganizationsService(repo);
    await expect(service.rename('org-1', 'fail')).rejects.toThrow('DB error');
  });
});
