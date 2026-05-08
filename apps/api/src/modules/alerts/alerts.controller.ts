/**
 * AlertsController — HTTP interface for the alert collaboration domain.
 *
 * sdd/alert-collaboration/spec — api-alerts domain.
 * sdd/alert-collaboration/design D5: coarse role guard here,
 *   fine-grained guards in AlertsService.
 *
 * Guard chain (standard scoped endpoints):
 *   JwtAuthGuard (global APP_GUARD) → MembershipFreshnessGuard (global) →
 *   OrgScopeGuard (global) → RolesGuard (global, enforces @Roles).
 *
 * organizationId: from @CurrentOrg() (set by OrgScopeGuard — NEVER from body).
 * actorId + role: from @CurrentUser() + @CurrentRole().
 *
 * Foot-gun #667: explicit @Inject(AlertsService).
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
  Query,
} from '@nestjs/common';
import { CurrentOrg, CurrentRole } from '../../common/auth/decorators/current-org.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { Roles } from '../../common/auth/decorators/roles.decorator.js';
import type { AuthUser } from '@regwatch/types';
import type { Role } from '@regwatch/types';
import { AlertsService } from './alerts.service.js';
import { listAlertsSchema } from './dto/list-alerts.dto.js';
import { transitionAlertSchema } from './dto/transition-alert.dto.js';
import { assignAlertSchema } from './dto/assign-alert.dto.js';
import { concludeAlertSchema } from './dto/conclude-alert.dto.js';
import { createCommentSchema } from './dto/create-comment.dto.js';

@Controller('alerts')
export class AlertsController {
  constructor(@Inject(AlertsService) private readonly service: AlertsService) {}

  /**
   * GET /alerts
   * List alerts for the active org with optional status/assignee filters.
   */
  @Get()
  @Roles('OWNER', 'ADMIN', 'ANALYST', 'VIEWER')
  async listAlerts(@Query() rawQuery: unknown, @CurrentOrg() orgId: string) {
    const result = listAlertsSchema.safeParse(rawQuery);
    if (!result.success)
      throw new BadRequestException({ message: 'Validation failed', issues: result.error.issues });
    return this.service.listAlerts(orgId, result.data);
  }

  /**
   * GET /alerts/:id
   * Get a single alert with enrichment data, assignee, and comment count.
   */
  @Get(':id')
  @Roles('OWNER', 'ADMIN', 'ANALYST', 'VIEWER')
  async getAlert(@Param('id') alertId: string, @CurrentOrg() orgId: string) {
    return this.service.getAlert(orgId, alertId);
  }

  /**
   * PATCH /alerts/:id/status
   * Transition the alert's status through the state machine.
   */
  @Patch(':id/status')
  @Roles('OWNER', 'ADMIN', 'ANALYST')
  async transitionStatus(
    @Param('id') alertId: string,
    @Body() rawBody: unknown,
    @CurrentOrg() orgId: string,
    @CurrentUser() user: AuthUser | undefined,
    @CurrentRole() role: Role,
  ) {
    const result = transitionAlertSchema.safeParse(rawBody);
    if (!result.success)
      throw new BadRequestException({ message: 'Validation failed', issues: result.error.issues });
    return this.service.transition(
      orgId,
      alertId,
      result.data.status,
      { id: user!.userId, role },
      result.data.note,
    );
  }

  /**
   * PATCH /alerts/:id/assignee
   * Assign (or unassign) the alert to an org member.
   */
  @Patch(':id/assignee')
  @Roles('OWNER', 'ADMIN', 'ANALYST')
  async assignAlert(
    @Param('id') alertId: string,
    @Body() rawBody: unknown,
    @CurrentOrg() orgId: string,
    @CurrentUser() user: AuthUser | undefined,
    @CurrentRole() role: Role,
  ) {
    const result = assignAlertSchema.safeParse(rawBody);
    if (!result.success)
      throw new BadRequestException({ message: 'Validation failed', issues: result.error.issues });
    return this.service.assign(orgId, alertId, result.data.assigneeId, { id: user!.userId, role });
  }

  /**
   * PATCH /alerts/:id/conclusion
   * Set or update the conclusion text. OWNER/ADMIN only.
   */
  @Patch(':id/conclusion')
  @Roles('OWNER', 'ADMIN')
  async updateConclusion(
    @Param('id') alertId: string,
    @Body() rawBody: unknown,
    @CurrentOrg() orgId: string,
    @CurrentUser() user: AuthUser | undefined,
    @CurrentRole() role: Role,
  ) {
    const result = concludeAlertSchema.safeParse(rawBody);
    if (!result.success)
      throw new BadRequestException({ message: 'Validation failed', issues: result.error.issues });
    return this.service.conclude(orgId, alertId, result.data.conclusion, {
      id: user!.userId,
      role,
    });
  }

  /**
   * GET /alerts/:id/comments
   * List comments for an alert (cursor-paginated).
   */
  @Get(':id/comments')
  @Roles('OWNER', 'ADMIN', 'ANALYST', 'VIEWER')
  async listComments(
    @Param('id') alertId: string,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limitRaw: string | undefined,
    @CurrentOrg() orgId: string,
  ) {
    const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 20, 1), 100) : 20;
    return this.service.listComments(orgId, alertId, cursor, limit);
  }

  /**
   * POST /alerts/:id/comments
   * Create a comment on an alert. VIEWER → 403 (guard).
   */
  @Post(':id/comments')
  @HttpCode(HttpStatus.CREATED)
  @Roles('OWNER', 'ADMIN', 'ANALYST')
  async createComment(
    @Param('id') alertId: string,
    @Body() rawBody: unknown,
    @CurrentOrg() orgId: string,
    @CurrentUser() user: AuthUser | undefined,
    @CurrentRole() role: Role,
  ) {
    const result = createCommentSchema.safeParse(rawBody);
    if (!result.success)
      throw new BadRequestException({ message: 'Validation failed', issues: result.error.issues });
    return this.service.addComment(orgId, alertId, result.data.body, result.data.parentId, {
      id: user!.userId,
      role,
    });
  }

  /**
   * DELETE /alerts/:id/comments/:cid
   * Delete a comment. OWNER/ADMIN can delete any; ANALYST can delete own only.
   */
  @Delete(':id/comments/:cid')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('OWNER', 'ADMIN', 'ANALYST')
  async deleteComment(
    @Param('id') alertId: string,
    @Param('cid') commentId: string,
    @CurrentOrg() orgId: string,
    @CurrentUser() user: AuthUser | undefined,
    @CurrentRole() role: Role,
  ) {
    await this.service.deleteComment(orgId, alertId, commentId, { id: user!.userId, role });
  }

  /**
   * GET /alerts/:id/events
   * Get the full audit event log for an alert.
   */
  @Get(':id/events')
  @Roles('OWNER', 'ADMIN', 'ANALYST', 'VIEWER')
  async listEvents(@Param('id') alertId: string, @CurrentOrg() orgId: string) {
    return this.service.listEvents(orgId, alertId);
  }
}
