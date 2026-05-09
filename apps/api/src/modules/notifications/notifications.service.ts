/**
 * NotificationsService — channel CRUD orchestration.
 *
 * sdd/notify-slack/design D3, D6.
 * sdd/segmented-distribution (MVP-14):
 *   - `upsertChannel()` replaced by `createChannel()` (pure insert, HTTP 201).
 *   - `patchChannel()` now forwards `jurisdictions` to the repo.
 *
 * Thin orchestration layer between controller and repository.
 *
 * Foot-gun #667: explicit @Inject(NOTIFICATIONS_REPO_TOKEN).
 */

import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { NOTIFICATIONS_REPO_TOKEN } from './tokens.js';
import type { NotificationsRepo, NotificationChannelRow } from './notifications.repository.js';
import type { CreateChannelDto, PatchChannelDto } from './dto/create-channel.dto.js';
import type { NotificationProvider } from '@regwatch/db/client';

@Injectable()
export class NotificationsService {
  constructor(@Inject(NOTIFICATIONS_REPO_TOKEN) private readonly repo: NotificationsRepo) {}

  async listChannels(organizationId: string): Promise<NotificationChannelRow[]> {
    return this.repo.listChannels(organizationId);
  }

  async createChannel(
    organizationId: string,
    dto: CreateChannelDto,
  ): Promise<NotificationChannelRow> {
    return this.repo.createChannel({
      organizationId,
      provider: dto.provider as NotificationProvider,
      webhookUrl: dto.webhookUrl,
      channelName: dto.channelName ?? null,
      jurisdictions: dto.jurisdictions,
    });
  }

  async patchChannel(
    organizationId: string,
    channelId: string,
    dto: PatchChannelDto,
  ): Promise<NotificationChannelRow> {
    const existing = await this.requireOwned(organizationId, channelId);
    void existing; // ownership confirmed

    const patch: Partial<{
      webhookUrl: string;
      channelName: string | null;
      isActive: boolean;
      jurisdictions: string[];
    }> = {};
    if (dto.webhookUrl !== undefined) patch.webhookUrl = dto.webhookUrl;
    if (dto.channelName !== undefined) patch.channelName = dto.channelName;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;
    if (dto.jurisdictions !== undefined) patch.jurisdictions = dto.jurisdictions;

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
    const found = await this.repo.findById(channelId);
    if (!found || found.organizationId !== organizationId) {
      // Channel either doesn't exist or belongs to another org → 403 per spec
      throw new ForbiddenException('Channel not found or access denied');
    }
    return found;
  }
}
