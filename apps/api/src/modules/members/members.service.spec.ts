import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MembersService } from './members.service.js';
import type { MembersRepo } from './members.repo.js';

/**
 * B2 scope — `MembersService` exposes only `getCurrentVersion`. The
 * transactional `mutate()` chokepoint lands in B3 and will get its own
 * dedicated spec covering the OWNER/personalOrg/self-promote invariants
 * and `User.membershipsVersion` bump inside `prisma.$transaction(...)`.
 *
 * Spec: `sdd/org-members/spec` R-Jwt-Invalidate-Cross-User
 *   (the freshness guard reads the live version via this method).
 * Design: `sdd/org-members/design` §0 #4, §3, §5.
 */

function makeRepo(): MembersRepo {
  return {
    getUserMembershipsVersion: vi.fn(),
  };
}

describe('MembersService.getCurrentVersion', () => {
  let repo: MembersRepo;

  beforeEach(() => {
    repo = makeRepo();
  });

  it('delegates to repo.getUserMembershipsVersion and returns the value verbatim', async () => {
    vi.mocked(repo.getUserMembershipsVersion).mockResolvedValue(7);
    const service = new MembersService(repo);

    const result = await service.getCurrentVersion('user-1');

    expect(result).toBe(7);
    expect(repo.getUserMembershipsVersion).toHaveBeenCalledTimes(1);
    expect(repo.getUserMembershipsVersion).toHaveBeenCalledWith('user-1');
  });

  it('does not memoize — every call reaches the repo (cache lives at the guard layer)', async () => {
    vi.mocked(repo.getUserMembershipsVersion).mockResolvedValueOnce(3).mockResolvedValueOnce(4);
    const service = new MembersService(repo);

    const a = await service.getCurrentVersion('user-1');
    const b = await service.getCurrentVersion('user-1');

    expect(a).toBe(3);
    expect(b).toBe(4);
    expect(repo.getUserMembershipsVersion).toHaveBeenCalledTimes(2);
  });

  it('propagates repo rejections unchanged', async () => {
    const boom = new Error('db dead');
    vi.mocked(repo.getUserMembershipsVersion).mockRejectedValue(boom);
    const service = new MembersService(repo);

    await expect(service.getCurrentVersion('user-1')).rejects.toBe(boom);
  });
});
