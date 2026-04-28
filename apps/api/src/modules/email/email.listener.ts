import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EMAIL_PORT, type EmailMessage, type EmailPort } from './email.port.js';
import {
  INVITATION_CREATED_EVENT,
  type InvitationCreatedEvent,
} from './events/invitation-created.event.js';

/**
 * Subscribes to `invitation.created` and dispatches an invitation email
 * via the configured {@link EmailPort}.
 *
 * Spec: `sdd/org-invitations/spec` R-Email-Port-Hexagonal:
 *   - Scenario "Email port called on issue" — handler invokes
 *     `EmailPort.send` exactly once when the issue tx commits.
 *   - Scenario "Email send failure does NOT roll back" — handler MUST
 *     swallow port errors so the controller's 201 response stands and
 *     the committed `Invitation` row is preserved.
 *
 * Design: `sdd/org-invitations/design` D3 (EventEmitter2 + `@OnEvent`,
 *   POST-commit, fire-and-forget), D4 (port shape), Q-A locked decision
 *   (no re-throw, log at warn).
 *
 * Foot-gun #667 (tsx + NestJS DI no decorator metadata): explicit
 * `@Inject(EMAIL_PORT)` is mandatory — the symbol-keyed lookup bypasses
 * the missing `design:paramtypes` reflection that would otherwise be
 * needed to resolve the port by interface type.
 *
 * Template scope: MVP renders the body inline (HTML + plain-text). The
 * Resend swap (`regwatch/pending/resend-swap` #694) is the right time to
 * swap to a templated/MJML pipeline; the listener stays untouched.
 */
@Injectable()
export class EmailListener {
  private readonly logger = new Logger(EmailListener.name);

  constructor(@Inject(EMAIL_PORT) private readonly emailPort: EmailPort) {}

  /**
   * Handle `invitation.created` events.
   *
   * `{ async: true }` so EventEmitter2 awaits the handler (allows
   * deterministic asserts in unit tests + propagates errors to our
   * try/catch, not the synchronous emit() call site).
   *
   * The handler NEVER re-throws — port failures are logged at `warn`
   * with the recipient address (no token / no PII beyond `to`) so an
   * operator can correlate without compromising security.
   */
  @OnEvent(INVITATION_CREATED_EVENT, { async: true })
  async handle(event: InvitationCreatedEvent): Promise<void> {
    try {
      const message = this.buildMessage(event);
      await this.emailPort.send(message);
    } catch (err) {
      // POST-commit fire-and-forget per Q-A. Never propagate — the
      // originating issue transaction has already committed and the
      // controller has already responded 201.
      this.logger.warn(
        `EmailListener.handle failed to=${event.to}: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  /**
   * Build the wire payload for the invitation email.
   *
   * Kept as a pure method (no I/O, no DI calls) so the unit test can
   * assert the rendered body without booting a TestingModule.
   */
  private buildMessage(event: InvitationCreatedEvent): EmailMessage {
    const inviter = event.inviterName ?? 'A teammate';
    const subject = `${inviter} invited you to ${event.orgName} on RegWatch`;
    const expiresIso = event.expiresAt.toISOString();

    const text = [
      `${inviter} invited you to join ${event.orgName} on RegWatch as ${event.role}.`,
      ``,
      `Accept the invitation:`,
      event.acceptUrl,
      ``,
      `This invitation expires on ${expiresIso}.`,
      ``,
      `If you weren't expecting this, ignore this email.`,
    ].join('\n');

    const html = [
      `<p><strong>${escapeHtml(inviter)}</strong> invited you to join `,
      `<strong>${escapeHtml(event.orgName)}</strong> on RegWatch as `,
      `<strong>${escapeHtml(event.role)}</strong>.</p>`,
      `<p><a href="${escapeHtml(event.acceptUrl)}">Accept the invitation</a></p>`,
      `<p>This invitation expires on <code>${escapeHtml(expiresIso)}</code>.</p>`,
      `<p>If you weren't expecting this, ignore this email.</p>`,
    ].join('');

    return {
      to: event.to,
      subject,
      html,
      text,
      tags: {
        kind: 'invitation',
        role: event.role,
      },
    };
  }
}

/**
 * Minimal HTML escaper for the inline template. Resend swap will pull
 * in a real templating engine; for MVP this prevents body-injection via
 * org names containing `<script>`.
 */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
