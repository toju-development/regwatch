/**
 * ResendEmailAdapter — implements `EmailPort` using the Resend REST API.
 *
 * sdd/notify-email-resend (POST-2) — task 2.1.
 *
 * Uses native `fetch` (no Resend SDK) to POST to `https://api.resend.com/emails`.
 * Throws on non-2xx so the caller (EmailListener, ResendEmailNotificationAdapter)
 * can catch, log, and swallow the error (fire-and-forget per design D3).
 *
 * Foot-gun #667: injected via RESEND_API_KEY / RESEND_FROM_EMAIL string tokens —
 * NOT via constructor class because EmailModule conditionally binds this adapter.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { EmailMessage, EmailPort } from '../email.port.js';

export const RESEND_API_KEY_TOKEN = 'RESEND_API_KEY_TOKEN';
export const RESEND_FROM_EMAIL_TOKEN = 'RESEND_FROM_EMAIL_TOKEN';

interface ResendEmailBody {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class ResendEmailAdapter implements EmailPort {
  constructor(
    @Inject(RESEND_API_KEY_TOKEN) private readonly apiKey: string,
    @Inject(RESEND_FROM_EMAIL_TOKEN) private readonly fromEmail: string,
  ) {}

  async send(email: EmailMessage): Promise<void> {
    const body: ResendEmailBody = {
      from: this.fromEmail,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    };

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const responseBody = await res.text().catch(() => '');
      throw new Error(`Resend API returned ${res.status}: ${responseBody}`);
    }
  }
}
