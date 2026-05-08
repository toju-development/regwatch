/**
 * SlackAdapter — implements `NotificationPort` using Slack Incoming Webhooks.
 *
 * sdd/notify-slack/design D4: native `fetch` only (no Slack SDK).
 * sdd/notify-slack/spec: Block Kit `attachments` array with `color` + `text` +
 *   "View alert →" action link.
 *
 * Throws on non-2xx — the listener catches and logs (fire-and-forget).
 *
 * Foot-gun #667: no constructor injection needed here; the adapter is a pure
 * stateless HTTP client. It receives the webhook URL per-call via context.
 */

import { Injectable } from '@nestjs/common';
import type { NotificationPort, NotificationContext } from '@regwatch/types';
import type {
  AlertConcludedEvent,
  AlertStatusChangedEvent,
  AlertAssignedEvent,
} from '@regwatch/types';
import type { AlertStatus } from '@regwatch/types';

// ─── Color palette ────────────────────────────────────────────────────────────

const COLOR_CONCLUDED = '#22c55e'; // green
const COLOR_ASSIGNED = '#3b82f6'; // blue

const STATUS_COLORS: Record<AlertStatus, string> = {
  NEW: '#94a3b8', // slate
  TRIAGING: '#f59e0b', // amber
  ANALYZING: '#3b82f6', // blue
  DEBATING: '#8b5cf6', // violet
  CONCLUDED: COLOR_CONCLUDED,
  DISTRIBUTED: '#10b981', // emerald
  ARCHIVED: '#6b7280', // gray
};

// ─── Block Kit helpers ────────────────────────────────────────────────────────

interface SlackAttachment {
  color: string;
  text: string;
  actions?: Array<{ type: string; text: string; url: string }>;
}

interface SlackPayload {
  attachments: SlackAttachment[];
}

function viewAlertAction(alertUrl: string) {
  return { type: 'button', text: 'View alert →', url: alertUrl };
}

function buildAttachment(color: string, text: string, alertUrl: string): SlackAttachment {
  return {
    color,
    text,
    actions: [viewAlertAction(alertUrl)],
  };
}

async function post(webhookUrl: string, payload: SlackPayload): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Slack webhook returned ${res.status}: ${body}`);
  }
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

@Injectable()
export class SlackAdapter implements NotificationPort {
  async sendAlertConcluded(_payload: AlertConcludedEvent, ctx: NotificationContext): Promise<void> {
    const text =
      `🟢 *Alert concluded* by ${ctx.actorName}\n` + `*${ctx.alertTitle}* — ${ctx.orgName}`;

    await post(ctx.webhookUrl, {
      attachments: [buildAttachment(COLOR_CONCLUDED, text, ctx.alertUrl)],
    });
  }

  async sendAlertStatusChanged(
    payload: AlertStatusChangedEvent,
    ctx: NotificationContext,
  ): Promise<void> {
    const color = STATUS_COLORS[payload.toStatus as AlertStatus] ?? '#94a3b8';
    const text =
      `🔵 *Status changed* to \`${payload.toStatus}\` by ${ctx.actorName}\n` +
      `*${ctx.alertTitle}* — ${ctx.orgName}`;

    await post(ctx.webhookUrl, {
      attachments: [buildAttachment(color, text, ctx.alertUrl)],
    });
  }

  async sendAlertAssigned(_payload: AlertAssignedEvent, ctx: NotificationContext): Promise<void> {
    const assigneeLabel = ctx.assigneeName ?? 'Unassigned';
    const text =
      `🔔 *Alert assigned* to ${assigneeLabel} by ${ctx.actorName}\n` +
      `*${ctx.alertTitle}* — ${ctx.orgName}`;

    await post(ctx.webhookUrl, {
      attachments: [buildAttachment(COLOR_ASSIGNED, text, ctx.alertUrl)],
    });
  }

  async sendAlertStatusChanged(
    payload: AlertStatusChangedEvent,
    ctx: NotificationContext & { webhookUrl: string },
  ): Promise<void> {
    const color = STATUS_COLORS[payload.toStatus as AlertStatus] ?? '#94a3b8';
    const text =
      `🔵 *Status changed* to \`${payload.toStatus}\` by ${ctx.actorName}\n` +
      `*${ctx.alertTitle}* — ${ctx.orgName}`;

    await post(ctx.webhookUrl, {
      attachments: [buildAttachment(color, text, ctx.alertUrl)],
    });
  }

  async sendAlertAssigned(
    _payload: AlertAssignedEvent,
    ctx: NotificationContext & { webhookUrl: string },
  ): Promise<void> {
    const assigneeLabel = ctx.assigneeName ?? 'Unassigned';
    const text =
      `🔔 *Alert assigned* to ${assigneeLabel} by ${ctx.actorName}\n` +
      `*${ctx.alertTitle}* — ${ctx.orgName}`;

    await post(ctx.webhookUrl, {
      attachments: [buildAttachment(COLOR_ASSIGNED, text, ctx.alertUrl)],
    });
  }
}
