/**
 * Unit tests for `NotificationsRepo`.
 *
 * sdd/notify-slack/spec:
 *  - findChannel returns null for unknown orgId
 *  - upsertChannel resolves without duplicating on same provider
 *
 * Uses a Prisma mock (no real DB).
 *
 * NO `pnpm build` after changes (project rule).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationsRepo } from '../notifications.repository.js';
import type { PrismaClient } from '@regwatch/db/client';

// ─── Prisma mock ──────────────────────────────────────────────────────────────

function makeChannel(overrides = {}) {
  return {
    id: 'chan-1',
    organizationId: 'org-1',
    provider: 'SLACK' as const,
    webhookUrl: 'https://hooks.slack.com/test',
    channelName: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePrismaMock() {
  return {
    notificationChannel: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
  } as unknown as PrismaClient;
}

function makeRepo(prisma: PrismaClient) {
  return new (NotificationsRepo as unknown as new (prisma: PrismaClient) => NotificationsRepo)(
    prisma,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NotificationsRepo', () => {
  let prisma: PrismaClient;
  let repo: NotificationsRepo;

  beforeEach(() => {
    prisma = makePrismaMock();
    repo = makeRepo(prisma);
  });

  it('findChannel: returns null for unknown orgId', async () => {
    (prisma.notificationChannel.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await repo.findChannel('unknown-org', 'SLACK');
    expect(result).toBeNull();
    expect(prisma.notificationChannel.findUnique).toHaveBeenCalledWith({
      where: { organizationId_provider: { organizationId: 'unknown-org', provider: 'SLACK' } },
    });
  });

  it('findChannel: returns channel row when found', async () => {
    const channel = makeChannel();
    (prisma.notificationChannel.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(channel);

    const result = await repo.findChannel('org-1', 'SLACK');
    expect(result?.id).toBe('chan-1');
    expect(result?.provider).toBe('SLACK');
  });

  it('upsertChannel: calls prisma.upsert with correct where clause', async () => {
    const channel = makeChannel();
    (prisma.notificationChannel.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(channel);

    const result = await repo.upsertChannel({
      organizationId: 'org-1',
      provider: 'SLACK',
      webhookUrl: 'https://hooks.slack.com/test',
      channelName: null,
    });

    expect(result.id).toBe('chan-1');
    const call = (prisma.notificationChannel.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where).toEqual({
      organizationId_provider: { organizationId: 'org-1', provider: 'SLACK' },
    });
  });

  it('listChannels: returns array ordered by createdAt asc', async () => {
    const channels = [makeChannel({ id: 'c1' }), makeChannel({ id: 'c2' })];
    (prisma.notificationChannel.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(channels);

    const result = await repo.listChannels('org-1');
    expect(result).toHaveLength(2);
    const call = (prisma.notificationChannel.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.orderBy).toEqual({ createdAt: 'asc' });
  });

  it('deleteChannel: calls prisma.delete with correct id', async () => {
    (prisma.notificationChannel.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await repo.deleteChannel('chan-1');
    expect(prisma.notificationChannel.delete).toHaveBeenCalledWith({ where: { id: 'chan-1' } });
  });
});
