/**
 * NotificationsListenerService — handles alert lifecycle events and posts
 * Slack notifications via the `NotificationPort`.
 *
 * sdd/notify-slack/design D5: dedup guard for CONCLUDED.
 * sdd/notify-slack/spec: fire-and-forget, catch + log, never rethrow.
 *
 * Context resolution (D7): single composite DB query per event resolves
 * alert, actor, assignee, org, and Slack channel row.
 *
 * Foot-gun #667: explicit @Inject tokens everywhere.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { PrismaClient } from '@regwatch/db/client';
import type {
  NotificationPort,
  NotificationContext,
  AlertConcludedEvent,
  AlertStatusChangedEvent,
  AlertAssignedEvent,
} from '@regwatch/types';
import {
  ALERT_CONCLUDED_EVENT,
  ALERT_STATUS_CHANGED_EVENT,
  ALERT_ASSIGNED_EVENT,
} from '@regwatch/types';
import { NOTIFICATIONS_PRISMA_TOKEN, NOTIFICATION_PORT_TOKEN } from './tokens.js';
import { env } from '../../env.js';

@Injectable()
export class NotificationsListenerService {
  private readonly logger = new Logger(NotificationsListenerService.name);

  constructor(
    @Inject(NOTIFICATIONS_PRISMA_TOKEN) private readonly prisma: PrismaClient,
    @Inject(NOTIFICATION_PORT_TOKEN) private readonly port: NotificationPort,
  ) {}

  // ─── alert.concluded ────────────────────────────────────────────────────────

  @OnEvent(ALERT_CONCLUDED_EVENT, { async: true })
  async onAlertConcluded(payload: AlertConcludedEvent): Promise<void> {
    try {
      const ctx = await this.resolveContext(
        payload.alertId,
        payload.organizationId,
        payload.actorId,
        null,
      );
      if (!ctx) return;

      await this.port.sendAlertConcluded(payload, ctx);
    } catch (err) {
      this.logger.error({
        event: ALERT_CONCLUDED_EVENT,
        alertId: payload.alertId,
        organizationId: payload.organizationId,
        error: (err as Error)?.message ?? String(err),
      });
    }
  }

  // ─── alert.status.changed ───────────────────────────────────────────────────

  @OnEvent(ALERT_STATUS_CHANGED_EVENT, { async: true })
  async onAlertStatusChanged(payload: AlertStatusChangedEvent): Promise<void> {
    // D5: dedup guard — alert.concluded is the canonical message for CONCLUDED transitions
    if (payload.toStatus === 'CONCLUDED') return;

    try {
      const ctx = await this.resolveContext(
        payload.alertId,
        payload.organizationId,
        payload.actorId,
        null,
      );
      if (!ctx) return;

      await this.port.sendAlertStatusChanged(payload, ctx);
    } catch (err) {
      this.logger.error({
        event: ALERT_STATUS_CHANGED_EVENT,
        alertId: payload.alertId,
        organizationId: payload.organizationId,
        toStatus: payload.toStatus,
        error: (err as Error)?.message ?? String(err),
      });
    }
  }

  // ─── alert.assigned ─────────────────────────────────────────────────────────

  @OnEvent(ALERT_ASSIGNED_EVENT, { async: true })
  async onAlertAssigned(payload: AlertAssignedEvent): Promise<void> {
    try {
      const ctx = await this.resolveContext(
        payload.alertId,
        payload.organizationId,
        payload.actorId,
        payload.assigneeId,
      );
      if (!ctx) return;

      await this.port.sendAlertAssigned(payload, ctx);
    } catch (err) {
      this.logger.error({
        event: ALERT_ASSIGNED_EVENT,
        alertId: payload.alertId,
        organizationId: payload.organizationId,
        assigneeId: payload.assigneeId,
        error: (err as Error)?.message ?? String(err),
      });
    }
  }

  // ─── Context resolution ──────────────────────────────────────────────────────

  /**
   * Resolves all enrichment data in a single composite DB query.
   * Returns `null` when no active Slack channel is configured for the org —
   * callers MUST return early without invoking the port.
   */
  private async resolveContext(
    alertId: string,
    organizationId: string,
    actorId: string,
    assigneeId: string | null,
  ): Promise<NotificationContext | null> {
    const [channel, alert, actor, assignee, org] = await Promise.all([
      this.prisma.notificationChannel.findUnique({
        where: { organizationId_provider: { organizationId, provider: 'SLACK' } },
        select: { webhookUrl: true, isActive: true },
      }),
      this.prisma.alert.findUnique({
        where: { id: alertId },
        select: { title: true, sourceUrl: true },
      }),
      this.prisma.user.findUnique({
        where: { id: actorId },
        select: { name: true, email: true },
      }),
      assigneeId
        ? this.prisma.user.findUnique({
            where: { id: assigneeId },
            select: { name: true, email: true },
          })
        : Promise.resolve(null),
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      }),
    ]);

    // No channel configured or inactive → skip silently
    if (!channel || !channel.isActive) return null;
    if (!alert || !org) return null;

    const rawTitle = alert.title ?? alert.sourceUrl ?? alertId;
    const alertTitle = rawTitle.length > 120 ? rawTitle.slice(0, 117) + '...' : rawTitle;
    const alertUrl = `${env.APP_URL}/alerts/${alertId}`;
    const actorName = actor?.name ?? actor?.email ?? actorId;
    const assigneeName = assignee ? (assignee.name ?? assignee.email ?? assigneeId) : null;

    return {
      alertId,
      alertTitle,
      alertUrl,
      orgName: org.name,
      actorName,
      assigneeName,
      webhookUrl: channel.webhookUrl,
    };
  }
}
