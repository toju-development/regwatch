/**
 * NotificationsController — HTTP interface for notification channel management.
 *
 * sdd/notify-slack/spec R "Channel CRUD Endpoints".
 * sdd/notify-slack/design D6: /notifications/channels resource.
 *
 * Guard chain (global): JwtAuthGuard → MembershipFreshnessGuard → OrgScopeGuard → RolesGuard.
 * organizationId: from @CurrentOrg() (set by OrgScopeGuard — NEVER from body).
 *
 * POST is idempotent (upsert) → returns 200 always (not 201).
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
import { upsertChannelSchema, patchChannelSchema } from './dto/upsert-channel.dto.js';

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
   * Upsert a notification channel (idempotent on provider per org).
   * Returns HTTP 200 whether creating or updating.
   */
  @Post('channels')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER', 'ADMIN')
  async upsertChannel(@Body() rawBody: unknown, @CurrentOrg() orgId: string) {
    const result = upsertChannelSchema.safeParse(rawBody);
    if (!result.success) {
      throw new BadRequestException({ message: 'Validation failed', issues: result.error.issues });
    }
    return this.service.upsertChannel(orgId, result.data);
  }

  /**
   * PATCH /notifications/channels/:id
   * Partially update a channel (webhookUrl, channelName, isActive).
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
