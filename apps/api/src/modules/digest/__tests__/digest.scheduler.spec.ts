/**
 * Unit tests for DigestSchedulerService.
 *
 * sdd/digest-export (POST-3) — task 7.3.
 *
 * Spec coverage:
 *  - Weekly cron trigger: runDigest calls buildAndSend once per org
 *  - Errors per org are caught; other orgs continue processing
 */

import { describe, it, expect, vi } from 'vitest';
import { DigestSchedulerService } from '../digest.scheduler.service.js';
import type { DigestService } from '../digest.service.js';
import type { PrismaClient } from '@regwatch/db/client';

function makePrismaMock(orgs: { id: string; name: string }[]) {
  return {
    organization: {
      findMany: vi.fn().mockResolvedValue(orgs),
    },
  } as unknown as PrismaClient;
}

function makeScheduler(
  orgs: { id: string; name: string }[],
  buildAndSendImpl?: () => Promise<void>,
) {
  const prisma = makePrismaMock(orgs);
  const digestService = {
    buildAndSend: vi.fn().mockImplementation(buildAndSendImpl ?? (() => Promise.resolve())),
  } as unknown as DigestService;

  const scheduler = new (DigestSchedulerService as unknown as new (
    prisma: PrismaClient,
    service: DigestService,
  ) => DigestSchedulerService)(prisma, digestService);

  return { scheduler, prisma, digestService };
}

describe('DigestSchedulerService', () => {
  const now = new Date('2026-05-10T08:00:00.000Z');

  it('calls buildAndSend once per org', async () => {
    const orgs = [
      { id: 'org-1', name: 'Acme' },
      { id: 'org-2', name: 'Beta' },
    ];
    const { scheduler, digestService } = makeScheduler(orgs);

    await scheduler.runDigest(now);

    expect(digestService.buildAndSend).toHaveBeenCalledTimes(2);
    expect(digestService.buildAndSend).toHaveBeenCalledWith('org-1', 'Acme', expect.any(Date), now);
    expect(digestService.buildAndSend).toHaveBeenCalledWith('org-2', 'Beta', expect.any(Date), now);
  });

  it('window start is 7 days before now', async () => {
    const orgs = [{ id: 'org-1', name: 'Acme' }];
    const { scheduler, digestService } = makeScheduler(orgs);

    await scheduler.runDigest(now);

    const call = (digestService.buildAndSend as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const windowStart = call[2] as Date;
    const expectedStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(windowStart.getTime()).toBe(expectedStart.getTime());
  });

  it('continues processing other orgs when one throws', async () => {
    const orgs = [
      { id: 'org-1', name: 'Acme' },
      { id: 'org-2', name: 'Beta' },
    ];
    let callCount = 0;
    const { scheduler, digestService } = makeScheduler(orgs, async () => {
      callCount++;
      if (callCount === 1) throw new Error('Resend error');
    });

    // Should not throw
    await expect(scheduler.runDigest(now)).resolves.toBeUndefined();
    expect(digestService.buildAndSend).toHaveBeenCalledTimes(2);
  });

  it('does nothing when there are no orgs', async () => {
    const { scheduler, digestService } = makeScheduler([]);

    await scheduler.runDigest(now);

    expect(digestService.buildAndSend).not.toHaveBeenCalled();
  });
});
