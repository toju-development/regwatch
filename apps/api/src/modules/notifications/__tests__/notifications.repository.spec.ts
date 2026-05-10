/**
 * Unit tests for `NotificationsRepo`.
 *
 * sdd/notify-slack/spec:
 *  - findChannel returns null for unknown orgId
 *  - upsertChannel resolves without duplicating on same provider (legacy — now delegates to createChannel)
 *
 * sdd/segmented-distribution (MVP-14):
 *  - 6.9 createChannel() inserts row and returns full NotificationChannelRow
 *  - 6.10 findActiveChannels() returns only isActive:true rows with correct shape
 *  - 6.11 updateChannel() with jurisdictions patch persists the new array
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
    jurisdictions: [] as string[],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePrismaMock() {
  return {
    notificationChannel: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
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

  // ── findChannel (legacy) ─────────────────────────────────────────────────────

  it('findChannel: returns null for unknown orgId', async () => {
    (prisma.notificationChannel.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await repo.findChannel('unknown-org', 'SLACK');
    expect(result).toBeNull();
    expect(prisma.notificationChannel.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'unknown-org', provider: 'SLACK' },
    });
  });

  it('findChannel: returns channel row when found', async () => {
    const channel = makeChannel();
    (prisma.notificationChannel.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(channel);

    const result = await repo.findChannel('org-1', 'SLACK');
    expect(result?.id).toBe('chan-1');
    expect(result?.provider).toBe('SLACK');
  });

  // ── 6.9: createChannel() inserts row and returns full row ──────────────────

  it('6.9: createChannel() calls prisma.create and returns NotificationChannelRow', async () => {
    const channel = makeChannel({ jurisdictions: ['AR', 'UY'] });
    (prisma.notificationChannel.create as ReturnType<typeof vi.fn>).mockResolvedValue(channel);

    const result = await repo.createChannel({
      organizationId: 'org-1',
      provider: 'SLACK',
      webhookUrl: 'https://hooks.slack.com/test',
      jurisdictions: ['AR', 'UY'],
    });

    expect(result.id).toBe('chan-1');
    expect(result.jurisdictions).toEqual(['AR', 'UY']);
    const call = (prisma.notificationChannel.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.data.organizationId).toBe('org-1');
    expect(call.data.jurisdictions).toEqual(['AR', 'UY']);
  });

  it('6.9b: createChannel() defaults jurisdictions to [] when not provided', async () => {
    const channel = makeChannel();
    (prisma.notificationChannel.create as ReturnType<typeof vi.fn>).mockResolvedValue(channel);

    await repo.createChannel({
      organizationId: 'org-1',
      provider: 'SLACK',
      webhookUrl: 'https://hooks.slack.com/test',
    });

    const call = (prisma.notificationChannel.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.data.jurisdictions).toEqual([]);
  });

  // ── 6.10: findActiveChannels() returns only isActive:true rows ─────────────

  it('6.10: findActiveChannels() queries with isActive:true and returns correct shape', async () => {
    const activeChannels = [
      { id: 'c1', webhookUrl: 'https://a.slack.com', channelName: null, jurisdictions: [] },
      {
        id: 'c2',
        webhookUrl: 'https://b.slack.com',
        channelName: '#general',
        jurisdictions: ['AR'],
      },
    ];
    (prisma.notificationChannel.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      activeChannels,
    );

    const result = await repo.findActiveChannels('org-1', 'SLACK');

    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('c1');
    expect(result[1]!.jurisdictions).toEqual(['AR']);

    const call = (prisma.notificationChannel.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(call.where).toEqual({ organizationId: 'org-1', provider: 'SLACK', isActive: true });
    expect(call.select).toEqual({
      id: true,
      webhookUrl: true,
      channelName: true,
      jurisdictions: true,
    });
  });

  // ── 6.11: updateChannel() with jurisdictions patch ─────────────────────────

  it('6.11: updateChannel() with jurisdictions patch calls prisma.update with jurisdictions', async () => {
    const updated = makeChannel({ jurisdictions: ['BR'] });
    (prisma.notificationChannel.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

    const result = await repo.updateChannel('chan-1', { jurisdictions: ['BR'] });

    expect(result.jurisdictions).toEqual(['BR']);
    const call = (prisma.notificationChannel.update as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where).toEqual({ id: 'chan-1' });
    expect(call.data).toEqual({ jurisdictions: ['BR'] });
  });

  // ── listChannels ─────────────────────────────────────────────────────────────

  it('listChannels: returns array ordered by createdAt asc', async () => {
    const channels = [makeChannel({ id: 'c1' }), makeChannel({ id: 'c2' })];
    (prisma.notificationChannel.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(channels);

    const result = await repo.listChannels('org-1');
    expect(result).toHaveLength(2);
    const call = (prisma.notificationChannel.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(call.orderBy).toEqual({ createdAt: 'asc' });
  });

  // ── deleteChannel ─────────────────────────────────────────────────────────────

  it('deleteChannel: calls prisma.delete with correct id', async () => {
    (prisma.notificationChannel.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await repo.deleteChannel('chan-1');
    expect(prisma.notificationChannel.delete).toHaveBeenCalledWith({ where: { id: 'chan-1' } });
  });
});
