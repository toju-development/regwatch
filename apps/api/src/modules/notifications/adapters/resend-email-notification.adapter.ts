/**
 * ResendEmailNotificationAdapter — implements `NotificationPort` for EMAIL channels.
 *
 * sdd/notify-email-resend (POST-2) — tasks 5.1, 5.2, 5.3.
 *
 * Injects the shared `EmailPort` (resolves to ResendEmailAdapter in production,
 * MemoryEmailAdapter in tests via EMAIL_TRANSPORT=memory). Builds an `EmailMessage`
 * from the event payload + `NotificationContext` using the template functions, then
 * delegates to `emailPort.send()`.
 *
 * Design D2: reads `ctx.recipientEmail` — never `ctx.webhookUrl` — so the semantic
 * is explicit. The listener sets `recipientEmail` from `ch.webhookUrl` for EMAIL channels.
 *
 * Foot-gun #667: inject EMAIL_PORT via symbol token.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { NotificationPort, NotificationContext } from '@regwatch/types';
import type {
  AlertConcludedEvent,
  AlertStatusChangedEvent,
  AlertAssignedEvent,
} from '@regwatch/types';
import { EMAIL_PORT, type EmailPort } from '../../email/email.port.js';
import { alertConcludedTemplate } from './templates/alert-concluded.template.js';
import { alertStatusChangedTemplate } from './templates/alert-status-changed.template.js';
import { alertAssignedTemplate } from './templates/alert-assigned.template.js';

@Injectable()
export class ResendEmailNotificationAdapter implements NotificationPort {
  constructor(@Inject(EMAIL_PORT) private readonly emailPort: EmailPort) {}

  async sendAlertConcluded(payload: AlertConcludedEvent, ctx: NotificationContext): Promise<void> {
    const template = alertConcludedTemplate(payload, ctx);
    await this.emailPort.send({
      to: ctx.recipientEmail!,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
  }

  async sendAlertStatusChanged(
    payload: AlertStatusChangedEvent,
    ctx: NotificationContext,
  ): Promise<void> {
    const template = alertStatusChangedTemplate(payload, ctx);
    await this.emailPort.send({
      to: ctx.recipientEmail!,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
  }

  async sendAlertAssigned(payload: AlertAssignedEvent, ctx: NotificationContext): Promise<void> {
    const template = alertAssignedTemplate(payload, ctx);
    await this.emailPort.send({
      to: ctx.recipientEmail!,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
  }
}
