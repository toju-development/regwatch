/**
 * NotificationsRepo — thin Prisma wrapper for the notifications domain.
 *
 * sdd/notify-slack/design D3: per-tenant DB webhook URLs (`notification_channels`).
 * sdd/segmented-distribution: adds `createChannel()` and `findActiveChannels()`;
 *   removes upsert (unique constraint dropped in migration #14); adds `jurisdictions`
 *   to `NotificationChannelRow` and `updateChannel` patch shape.
 *
 * All methods are pure data access — zero business logic here.
 *
 * Foot-gun #667: explicit @Inject(NOTIFICATIONS_PRISMA_TOKEN).
 */

import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@regwatch/db/client';
import type { NotificationProvider } from '@regwatch/db/client';
import { NOTIFICATIONS_PRISMA_TOKEN } from './tokens.js';

export interface NotificationChannelRow {
  id: string;
  organizationId: string;
  provider: NotificationProvider;
  webhookUrl: string;
  channelName: string | null;
  isActive: boolean;
  jurisdictions: string[];
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class NotificationsRepo {
  constructor(@Inject(NOTIFICATIONS_PRISMA_TOKEN) private readonly prisma: PrismaClient) {}

  /** @deprecated Use findById for targeted lookups. Will be removed post-MVP-14. */
  async findChannel(
    organizationId: string,
    provider: NotificationProvider,
  ): Promise<NotificationChannelRow | null> {
    return this.prisma.notificationChannel.findFirst({
      where: { organizationId, provider },
    }) as Promise<NotificationChannelRow | null>;
  }

  /**
   * Pure insert — creates a new channel row unconditionally.
   * The unique-per-org-provider constraint was dropped in migration #14;
   * multiple channels per org/provider are now valid.
   */
  async createChannel(data: {
    organizationId: string;
    provider: NotificationProvider;
    webhookUrl: string;
    channelName?: string | null;
    jurisdictions?: string[];
  }): Promise<NotificationChannelRow> {
    return this.prisma.notificationChannel.create({
      data: {
        organizationId: data.organizationId,
        provider: data.provider,
        webhookUrl: data.webhookUrl,
        channelName: data.channelName ?? null,
        jurisdictions: data.jurisdictions ?? [],
      },
    }) as Promise<NotificationChannelRow>;
  }

  /** @deprecated Use createChannel() for new channels. Kept for backward compatibility. */
  async upsertChannel(data: {
    organizationId: string;
    provider: NotificationProvider;
    webhookUrl: string;
    channelName?: string | null;
  }): Promise<NotificationChannelRow> {
    // Unique constraint gone — upsert is no longer meaningful.
    // Delegates to createChannel to preserve interface compatibility.
    return this.createChannel(data);
  }

  /**
   * Returns all active channels for an org/provider pair.
   * Used by the listener for fan-out; selects only the fields needed for dispatch.
   */
  async findActiveChannels(
    organizationId: string,
    provider: NotificationProvider,
  ): Promise<
    Pick<NotificationChannelRow, 'id' | 'webhookUrl' | 'channelName' | 'jurisdictions'>[]
  > {
    return this.prisma.notificationChannel.findMany({
      where: { organizationId, provider, isActive: true },
      select: { id: true, webhookUrl: true, channelName: true, jurisdictions: true },
    }) as Promise<
      Pick<NotificationChannelRow, 'id' | 'webhookUrl' | 'channelName' | 'jurisdictions'>[]
    >;
  }

  async listChannels(organizationId: string): Promise<NotificationChannelRow[]> {
    return this.prisma.notificationChannel.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    }) as Promise<NotificationChannelRow[]>;
  }

  async findById(id: string): Promise<NotificationChannelRow | null> {
    return this.prisma.notificationChannel.findUnique({
      where: { id },
    }) as Promise<NotificationChannelRow | null>;
  }

  async deleteChannel(id: string): Promise<void> {
    await this.prisma.notificationChannel.delete({ where: { id } });
  }

  async updateChannel(
    id: string,
    patch: Partial<{
      webhookUrl: string;
      channelName: string | null;
      isActive: boolean;
      jurisdictions: string[];
    }>,
  ): Promise<NotificationChannelRow> {
    return this.prisma.notificationChannel.update({
      where: { id },
      data: patch,
    }) as Promise<NotificationChannelRow>;
  }
}
