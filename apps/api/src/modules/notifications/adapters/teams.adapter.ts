/**
 * TeamsAdapter — implements `NotificationPort` using Microsoft Teams Incoming Webhooks
 * (MessageCard format, legacy but widely supported).
 *
 * sdd/notify-teams (POST-1): mirrors SlackAdapter; stateless, no constructor injection,
 * native fetch, throws on non-2xx so the listener can catch and log.
 *
 * Foot-gun #667: no constructor injection needed — the adapter is a pure
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

// ─── Color palette (hex WITHOUT leading #, as required by MessageCard) ─────────

const COLOR_CONCLUDED = '22c55e'; // green
const COLOR_ASSIGNED = '3b82f6'; // blue

const STATUS_COLORS: Record<AlertStatus, string> = {
  NEW: '94a3b8', // slate
  TRIAGING: 'f59e0b', // amber
  ANALYZING: '3b82f6', // blue
  DEBATING: '8b5cf6', // violet
  CONCLUDED: COLOR_CONCLUDED,
  DISTRIBUTED: '10b981', // emerald
  ARCHIVED: '6b7280', // gray
};

// ─── MessageCard shape ─────────────────────────────────────────────────────────

interface MessageCardFact {
  name: string;
  value: string;
}

interface MessageCardSection {
  activityTitle: string;
  activityText: string;
  facts: MessageCardFact[];
}

interface MessageCardAction {
  '@type': 'OpenUri';
  name: string;
  targets: Array<{ os: 'default'; uri: string }>;
}

interface MessageCard {
  '@type': 'MessageCard';
  '@context': 'http://schema.org/extensions';
  themeColor: string;
  summary: string;
  sections: MessageCardSection[];
  potentialAction?: MessageCardAction[];
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function post(webhookUrl: string, payload: unknown): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Teams webhook returned ${res.status}: ${body}`);
  }
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

@Injectable()
export class TeamsAdapter implements NotificationPort {
  async sendAlertConcluded(_payload: AlertConcludedEvent, ctx: NotificationContext): Promise<void> {
    const card: MessageCard = {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: COLOR_CONCLUDED,
      summary: 'Alert concluded',
      sections: [
        {
          activityTitle: '🟢 Alert concluded',
          activityText: `**${ctx.alertTitle}** — ${ctx.orgName}`,
          facts: [
            { name: 'Actor', value: ctx.actorName },
            { name: 'Alert', value: ctx.alertTitle },
          ],
        },
      ],
      potentialAction: [
        {
          '@type': 'OpenUri',
          name: 'View alert →',
          targets: [{ os: 'default', uri: ctx.alertUrl }],
        },
      ],
    };

    await post(ctx.webhookUrl, card);
  }

  async sendAlertStatusChanged(
    payload: AlertStatusChangedEvent,
    ctx: NotificationContext,
  ): Promise<void> {
    const color = STATUS_COLORS[payload.toStatus as AlertStatus] ?? '94a3b8';
    const card: MessageCard = {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: color,
      summary: `Alert status changed to ${payload.toStatus}`,
      sections: [
        {
          activityTitle: `🔵 Status changed to \`${payload.toStatus}\``,
          activityText: `**${ctx.alertTitle}** — ${ctx.orgName}`,
          facts: [
            { name: 'Status', value: payload.toStatus },
            { name: 'Alert', value: ctx.alertTitle },
          ],
        },
      ],
      potentialAction: [
        {
          '@type': 'OpenUri',
          name: 'View alert →',
          targets: [{ os: 'default', uri: ctx.alertUrl }],
        },
      ],
    };

    await post(ctx.webhookUrl, card);
  }

  async sendAlertAssigned(_payload: AlertAssignedEvent, ctx: NotificationContext): Promise<void> {
    const assigneeLabel = ctx.assigneeName ?? 'Unassigned';
    const card: MessageCard = {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: COLOR_ASSIGNED,
      summary: `Alert assigned to ${assigneeLabel}`,
      sections: [
        {
          activityTitle: `🔔 Alert assigned to ${assigneeLabel}`,
          activityText: `**${ctx.alertTitle}** — ${ctx.orgName}`,
          facts: [
            { name: 'Assignee', value: assigneeLabel },
            { name: 'Alert', value: ctx.alertTitle },
          ],
        },
      ],
      potentialAction: [
        {
          '@type': 'OpenUri',
          name: 'View alert →',
          targets: [{ os: 'default', uri: ctx.alertUrl }],
        },
      ],
    };

    await post(ctx.webhookUrl, card);
  }
}
