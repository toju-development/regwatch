/**
 * NotificationsListenerService — handles alert lifecycle events and fans out
 * notifications to all matching channels via `Promise.allSettled`.
 *
 * sdd/notify-teams (POST-1):
 *   - Inject `NotificationAdapterRegistry` instead of a single port.
 *   - Use `findAllActiveChannels(orgId)` (all providers) instead of SLACK-only.
 *   - Fan-out: for each channel, resolve adapter via `registry.get(ch.provider)`;
 *     skip silently if undefined (unknown provider).
 *
 * sdd/segmented-distribution (MVP-14):
 *   - Multi-channel fan-out with effectiveJurisdiction filtering.
 *   - DISTRIBUTED gate (onAlertStatusChanged only): emits DISTRIBUTED status iff
 *     `results.some(r => r.status === 'fulfilled')`.
 *
 * sdd/notify-slack/design D5: dedup guard for CONCLUDED.
 * sdd/notify-slack/spec: fire-and-forget, catch + log, never rethrow.
 *
 * Foot-gun #667: explicit @Inject tokens everywhere.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaClient } from '@regwatch/db/client';
import type {
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
import {
  NOTIFICATIONS_PRISMA_TOKEN,
  NOTIFICATION_ADAPTER_REGISTRY_TOKEN,
  NOTIFICATIONS_REPO_TOKEN,
} from './tokens.js';
import type { NotificationsRepo } from './notifications.repository.js';
import type { NotificationAdapterRegistry } from './notification-adapter.registry.js';
import { env } from '../../env.js';

// ─── Internal types ────────────────────────────────────────────────────────────

interface SharedCtx {
  alertId: string;
  alertTitle: string;
  alertUrl: string;
  orgName: string;
  actorName: string;
  assigneeName: string | null;
  effectiveJurisdiction: string | null;
}

type ActiveChannel = Pick<
  import('./notifications.repository.js').NotificationChannelRow,
  'id' | 'webhookUrl' | 'channelName' | 'provider' | 'jurisdictions'
>;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class NotificationsListenerService {
  private readonly logger = new Logger(NotificationsListenerService.name);

  constructor(
    @Inject(NOTIFICATIONS_PRISMA_TOKEN) private readonly prisma: PrismaClient,
    @Inject(NOTIFICATION_ADAPTER_REGISTRY_TOKEN)
    private readonly registry: NotificationAdapterRegistry,
    @Inject(NOTIFICATIONS_REPO_TOKEN) private readonly repo: NotificationsRepo,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  // ─── alert.concluded ────────────────────────────────────────────────────────

  @OnEvent(ALERT_CONCLUDED_EVENT, { async: true })
  async onAlertConcluded(payload: AlertConcludedEvent): Promise<void> {
    try {
      const { shared, channels } = await this.resolveContext(
        payload.alertId,
        payload.organizationId,
        payload.actorId,
        null,
      );
      if (!shared || channels.length === 0) return;

      await Promise.allSettled(
        channels.map((ch) => {
          const adapter = this.registry.get(ch.provider);
          if (!adapter) return Promise.resolve();
          return adapter.sendAlertConcluded(payload, this.buildCtx(shared, ch));
        }),
      );
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
    // D5: dedup guard — alert.concluded is the canonical message for CONCLUDED transitions.
    // Also skip DISTRIBUTED to prevent recursion (listener emits it below).
    if (payload.toStatus === 'CONCLUDED' || payload.toStatus === 'DISTRIBUTED') return;

    try {
      const { shared, channels } = await this.resolveContext(
        payload.alertId,
        payload.organizationId,
        payload.actorId,
        null,
      );
      if (!shared) return;
      if (channels.length === 0) return; // zero matched → DISTRIBUTED not emitted

      const results = await Promise.allSettled(
        channels.map((ch) => {
          const adapter = this.registry.get(ch.provider);
          if (!adapter) return Promise.resolve();
          return adapter.sendAlertStatusChanged(payload, this.buildCtx(shared, ch));
        }),
      );

      // DISTRIBUTED gate: emit iff at least one channel call fulfilled.
      if (results.some((r) => r.status === 'fulfilled')) {
        await this.emitDistributed(payload.alertId, payload.organizationId, payload.actorId);
      }
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
      const { shared, channels } = await this.resolveContext(
        payload.alertId,
        payload.organizationId,
        payload.actorId,
        payload.assigneeId,
      );
      if (!shared || channels.length === 0) return;

      await Promise.allSettled(
        channels.map((ch) => {
          const adapter = this.registry.get(ch.provider);
          if (!adapter) return Promise.resolve();
          return adapter.sendAlertAssigned(payload, this.buildCtx(shared, ch));
        }),
      );
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
   * Resolves shared enrichment data and matched channels in parallel.
   * Returns `{ shared: null, channels: [] }` when alert/org is not found.
   * Channel list is already filtered by effectiveJurisdiction catch-all rule.
   */
  private async resolveContext(
    alertId: string,
    organizationId: string,
    actorId: string,
    assigneeId: string | null,
  ): Promise<{ shared: SharedCtx | null; channels: ActiveChannel[] }> {
    const [alert, actor, assignee, org, rawChannels] = await Promise.all([
      this.prisma.alert.findUnique({
        where: { id: alertId },
        select: {
          title: true,
          sourceUrl: true,
          jurisdiction: true,
          scanLog: { select: { jurisdiction: true } },
        },
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
      this.repo.findAllActiveChannels(organizationId),
    ]);

    if (!alert || !org) return { shared: null, channels: [] };

    // effectiveJurisdiction: alert.jurisdiction ?? scanLog?.jurisdiction ?? null
    const effectiveJurisdiction: string | null =
      alert.jurisdiction ?? alert.scanLog?.jurisdiction ?? null;

    // Channel filter: catch-all (empty array) OR explicit allowlist match.
    const channels = rawChannels.filter(
      (ch) =>
        ch.jurisdictions.length === 0 ||
        (effectiveJurisdiction !== null && ch.jurisdictions.includes(effectiveJurisdiction)),
    );

    const rawTitle = alert.title ?? alert.sourceUrl ?? alertId;
    const alertTitle = rawTitle.length > 120 ? rawTitle.slice(0, 117) + '...' : rawTitle;
    const alertUrl = new URL(`/alerts/${alertId}`, env.APP_URL).toString();
    const actorName = actor?.name ?? actor?.email ?? actorId;
    const assigneeName = assignee ? (assignee.name ?? assignee.email ?? assigneeId) : null;

    return {
      shared: {
        alertId,
        alertTitle,
        alertUrl,
        orgName: org.name,
        actorName,
        assigneeName,
        effectiveJurisdiction,
      },
      channels,
    };
  }

  /** Builds per-channel NotificationContext from shared data. */
  private buildCtx(shared: SharedCtx, ch: ActiveChannel): NotificationContext {
    return {
      alertId: shared.alertId,
      alertTitle: shared.alertTitle,
      alertUrl: shared.alertUrl,
      orgName: shared.orgName,
      actorName: shared.actorName,
      assigneeName: shared.assigneeName,
      webhookUrl: ch.webhookUrl,
    };
  }

  /**
   * Updates alert.status to DISTRIBUTED in the DB and emits the status_changed event.
   * System-only — DISTRIBUTED is never set by human actors (schema comment, MVP-14).
   */
  private async emitDistributed(
    alertId: string,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    try {
      const alert = await this.prisma.alert.findUnique({
        where: { id: alertId },
        select: { status: true },
      });
      if (!alert || alert.status === 'DISTRIBUTED') return; // already distributed

      // updateMany with status-based optimistic concurrency check — prevents double-DISTRIBUTED
      // when two concurrent events race to call emitDistributed for the same alert.
      const updateResult = await this.prisma.alert.updateMany({
        where: { id: alertId, status: alert.status },
        data: { status: 'DISTRIBUTED' },
      });
      if (updateResult.count === 0) return; // changed concurrently — another process won

      this.events.emit(ALERT_STATUS_CHANGED_EVENT, {
        alertId,
        organizationId,
        actorId,
        fromStatus: alert.status,
        toStatus: 'DISTRIBUTED' as const,
        note: null,
        changedAt: new Date().toISOString(),
      } satisfies AlertStatusChangedEvent);
    } catch (err) {
      this.logger.error({
        msg: 'Failed to emit DISTRIBUTED status',
        alertId,
        organizationId,
        error: (err as Error)?.message ?? String(err),
      });
    }
  }
}
