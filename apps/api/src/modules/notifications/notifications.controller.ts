/**
 * NotificationsController — HTTP interface for notification channel management.
 *
 * sdd/notify-slack/spec R "Channel CRUD Endpoints".
 * sdd/notify-slack/design D6: /notifications/channels resource.
 * sdd/segmented-distribution (MVP-14):
 *   - POST is now a pure create (no upsert) → returns HTTP 201.
 *   - Uses `createChannelSchema` / `CreateChannelDto`.
 *
 * Guard chain (global): JwtAuthGuard → MembershipFreshnessGuard → OrgScopeGuard → RolesGuard.
 * organizationId: from @CurrentOrg() (set by OrgScopeGuard — NEVER from body).
 *
 * Foot-gun #667: explicit @Inject(NotificationsService).
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentOrg } from '../../common/auth/decorators/current-org.decorator.js';
import { Roles } from '../../common/auth/decorators/roles.decorator.js';
import { NotificationsService } from './notifications.service.js';
import { createChannelSchema, patchChannelSchema } from './dto/create-channel.dto.js';

@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly service: NotificationsService) {}

  /**
   * GET /notifications/channels
   * List all notification channels for the active org.
   */
  @Get('channels')
  @Roles('OWNER', 'ADMIN', 'ANALYST', 'VIEWER')
  async listChannels(@CurrentOrg() orgId: string) {
    return this.service.listChannels(orgId);
  }

  /**
   * POST /notifications/channels
   * Create a new notification channel. Returns HTTP 201.
   * Multiple channels per org/provider are allowed (unique constraint dropped in migration #14).
   */
  @Post('channels')
  @HttpCode(HttpStatus.CREATED)
  @Roles('OWNER', 'ADMIN')
  async createChannel(@Body() rawBody: unknown, @CurrentOrg() orgId: string) {
    const result = createChannelSchema.safeParse(rawBody);
    if (!result.success) {
      throw new BadRequestException({ message: 'Validation failed', issues: result.error.issues });
    }
    return this.service.createChannel(orgId, result.data);
  }

  /**
   * PATCH /notifications/channels/:id
   * Partially update a channel (webhookUrl, channelName, isActive, jurisdictions).
   * Returns 403 if channel belongs to a different org.
   */
  @Patch('channels/:id')
  @Roles('OWNER', 'ADMIN')
  async patchChannel(
    @Param('id') channelId: string,
    @Body() rawBody: unknown,
    @CurrentOrg() orgId: string,
  ) {
    const result = patchChannelSchema.safeParse(rawBody);
    if (!result.success) {
      throw new BadRequestException({ message: 'Validation failed', issues: result.error.issues });
    }
    return this.service.patchChannel(orgId, channelId, result.data);
  }

  /**
   * DELETE /notifications/channels/:id
   * Remove a channel. Returns 403 if channel belongs to a different org.
   */
  @Delete('channels/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('OWNER', 'ADMIN')
  async deleteChannel(@Param('id') channelId: string, @CurrentOrg() orgId: string) {
    await this.service.deleteChannel(orgId, channelId);
  }
}
