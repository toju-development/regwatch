/**
 * NotificationsService — channel CRUD orchestration.
 *
 * sdd/notify-slack/design D3, D6.
 * Thin orchestration layer between controller and repository.
 * upsert is idempotent on (organizationId, provider) — backed by @@unique DB constraint.
 *
 * Foot-gun #667: explicit @Inject(NOTIFICATIONS_REPO_TOKEN).
 */

import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { NOTIFICATIONS_REPO_TOKEN } from './tokens.js';
import type { NotificationsRepo, NotificationChannelRow } from './notifications.repository.js';
import type { UpsertChannelDto, PatchChannelDto } from './dto/upsert-channel.dto.js';
import type { NotificationProvider } from '@regwatch/db/client';

@Injectable()
export class NotificationsService {
  constructor(@Inject(NOTIFICATIONS_REPO_TOKEN) private readonly repo: NotificationsRepo) {}

  async listChannels(organizationId: string): Promise<NotificationChannelRow[]> {
    return this.repo.listChannels(organizationId);
  }

  async upsertChannel(
    organizationId: string,
    dto: UpsertChannelDto,
  ): Promise<NotificationChannelRow> {
    return this.repo.upsertChannel({
      organizationId,
      provider: dto.provider as NotificationProvider,
      webhookUrl: dto.webhookUrl,
      channelName: dto.channelName ?? null,
    });
  }

  async patchChannel(
    organizationId: string,
    channelId: string,
    dto: PatchChannelDto,
  ): Promise<NotificationChannelRow> {
    const existing = await this.requireOwned(organizationId, channelId);
    void existing; // ownership confirmed

    const patch: Partial<{ webhookUrl: string; channelName: string | null; isActive: boolean }> =
      {};
    if (dto.webhookUrl !== undefined) patch.webhookUrl = dto.webhookUrl;
    if (dto.channelName !== undefined) patch.channelName = dto.channelName;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;

    return this.repo.updateChannel(channelId, patch);
  }

  async deleteChannel(organizationId: string, channelId: string): Promise<void> {
    await this.requireOwned(organizationId, channelId);
    return this.repo.deleteChannel(channelId);
  }

  private async requireOwned(
    organizationId: string,
    channelId: string,
  ): Promise<NotificationChannelRow> {
    // We can't query by (orgId, channelId) in one shot without a raw query,
    // so we fetch by id and then assert ownership.
    const channels = await this.repo.listChannels(organizationId);
    const found = channels.find((c) => c.id === channelId);
    if (!found) {
      // Channel either doesn't exist or belongs to another org → 403 per spec
      throw new ForbiddenException('Channel not found or access denied');
    }
    return found;
  }
}
