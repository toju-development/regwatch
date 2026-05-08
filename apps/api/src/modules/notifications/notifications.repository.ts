/**
 * NotificationsRepo — thin Prisma wrapper for the notifications domain.
 *
 * sdd/notify-slack/design D3: per-tenant DB webhook URLs (`notification_channels`).
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
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class NotificationsRepo {
  constructor(@Inject(NOTIFICATIONS_PRISMA_TOKEN) private readonly prisma: PrismaClient) {}

  async findChannel(
    organizationId: string,
    provider: NotificationProvider,
  ): Promise<NotificationChannelRow | null> {
    return this.prisma.notificationChannel.findUnique({
      where: { organizationId_provider: { organizationId, provider } },
    }) as Promise<NotificationChannelRow | null>;
  }

  async upsertChannel(data: {
    organizationId: string;
    provider: NotificationProvider;
    webhookUrl: string;
    channelName?: string | null;
  }): Promise<NotificationChannelRow> {
    return this.prisma.notificationChannel.upsert({
      where: {
        organizationId_provider: {
          organizationId: data.organizationId,
          provider: data.provider,
        },
      },
      update: {
        webhookUrl: data.webhookUrl,
        channelName: data.channelName ?? undefined,
      },
      create: {
        organizationId: data.organizationId,
        provider: data.provider,
        webhookUrl: data.webhookUrl,
        channelName: data.channelName ?? null,
      },
    }) as Promise<NotificationChannelRow>;
  }

  async listChannels(organizationId: string): Promise<NotificationChannelRow[]> {
    return this.prisma.notificationChannel.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    }) as Promise<NotificationChannelRow[]>;
  }

  async deleteChannel(id: string): Promise<void> {
    await this.prisma.notificationChannel.delete({ where: { id } });
  }

  async updateChannel(
    id: string,
    patch: Partial<{ webhookUrl: string; channelName: string | null; isActive: boolean }>,
  ): Promise<NotificationChannelRow> {
    return this.prisma.notificationChannel.update({
      where: { id },
      data: patch,
    }) as Promise<NotificationChannelRow>;
  }
}
