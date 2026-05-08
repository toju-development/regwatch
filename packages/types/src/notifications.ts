/**
 * Notification domain contracts.
 *
 * `NotificationPort` — hexagonal port implemented by adapters (SlackAdapter,
 * future TeamsAdapter, EmailAdapter). Consumed by `NotificationsListenerService`.
 *
 * `NotificationContext` — enrichment data resolved per event from the DB
 * before invoking the port. Keeps event payloads lean (they only carry IDs).
 *
 * sdd/notify-slack/design D2, D7.
 */

import type { AlertConcludedEvent, AlertStatusChangedEvent, AlertAssignedEvent } from './events.js';

/**
 * Enrichment context resolved by the listener for each incoming alert event.
 * All name fields fall back gracefully: actor/assignee names may be null when
 * the user row lacks a display name.
 */
export interface NotificationContext {
  alertId: string;
  /** `alert.title` truncated to 120 chars, or truncated `sourceUrl` if title absent. */
  alertTitle: string;
  /** Deep-link URL, e.g. `https://app.regwatch.io/alerts/{alertId}`. */
  alertUrl: string;
  orgName: string;
  actorName: string;
  /** null when the alert is unassigned. */
  assigneeName: string | null;
  /** Slack Incoming Webhook URL resolved from `notification_channels` row. */
  webhookUrl: string;
}

/**
 * Hexagonal port for delivering alert lifecycle notifications.
 *
 * All methods are fire-and-forget from the listener's perspective — they MUST
 * throw on failure so the listener can catch, log, and swallow the error.
 */
export interface NotificationPort {
  sendAlertConcluded(payload: AlertConcludedEvent, ctx: NotificationContext): Promise<void>;
  sendAlertStatusChanged(payload: AlertStatusChangedEvent, ctx: NotificationContext): Promise<void>;
  sendAlertAssigned(payload: AlertAssignedEvent, ctx: NotificationContext): Promise<void>;
}
