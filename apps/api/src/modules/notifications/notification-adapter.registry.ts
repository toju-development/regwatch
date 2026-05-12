/**
 * NotificationAdapterRegistry — single dispatch point for all notification adapters.
 *
 * sdd/notify-teams (POST-1): keyed by NotificationProvider string so the listener
 * scales to N providers with zero changes. Unknown providers return `undefined`.
 *
 * sdd/notify-email-resend (POST-2): adds EMAIL entry via RESEND_EMAIL_NOTIFICATION_ADAPTER_TOKEN.
 *
 * Foot-gun #667: explicit @Inject tokens for each adapter.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { NotificationPort } from '@regwatch/types';
import {
  SLACK_ADAPTER_TOKEN,
  TEAMS_ADAPTER_TOKEN,
  RESEND_EMAIL_NOTIFICATION_ADAPTER_TOKEN,
} from './tokens.js';

@Injectable()
export class NotificationAdapterRegistry {
  private readonly map: Map<string, NotificationPort>;

  constructor(
    @Inject(SLACK_ADAPTER_TOKEN) slack: NotificationPort,
    @Inject(TEAMS_ADAPTER_TOKEN) teams: NotificationPort,
    @Inject(RESEND_EMAIL_NOTIFICATION_ADAPTER_TOKEN) email: NotificationPort,
  ) {
    this.map = new Map<string, NotificationPort>([
      ['SLACK', slack],
      ['TEAMS', teams],
      ['EMAIL', email],
    ]);
  }

  /** Returns the adapter for the given provider string, or `undefined` if unknown. */
  get(provider: string): NotificationPort | undefined {
    return this.map.get(provider);
  }
}
