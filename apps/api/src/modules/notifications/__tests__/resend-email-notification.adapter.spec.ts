/**
 * Unit tests for `ResendEmailNotificationAdapter`.
 *
 * sdd/notify-email-resend (POST-2) — task 7.1.
 *
 * Mocks `EmailPort` and asserts all 3 methods call `send()` with the
 * correct `to`, `subject`, and `html` values for each event type.
 *
 * NO `pnpm build` after changes (project rule).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResendEmailNotificationAdapter } from '../adapters/resend-email-notification.adapter.js';
import type { EmailPort } from '../../email/email.port.js';
import type { NotificationContext } from '@regwatch/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ctx: NotificationContext = {
  alertId: 'alert-1',
  alertTitle: 'Test Alert Title',
  alertUrl: 'http://localhost:3000/alerts/alert-1',
  orgName: 'Acme Corp',
  actorName: 'Jane Doe',
  assigneeName: 'John Smith',
  webhookUrl: 'compliance@acme.com',
  recipientEmail: 'compliance@acme.com',
};

function makeEmailPort(): EmailPort {
  return { send: vi.fn().mockResolvedValue(undefined) };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ResendEmailNotificationAdapter', () => {
  let adapter: ResendEmailNotificationAdapter;
  let emailPort: EmailPort;

  beforeEach(() => {
    emailPort = makeEmailPort();
    // Bypass NestJS DI — inject directly
    adapter = new (ResendEmailNotificationAdapter as unknown as new (
      ep: EmailPort,
    ) => ResendEmailNotificationAdapter)(emailPort);
  });

  // ── sendAlertConcluded ─────────────────────────────────────────────────────

  it('sendAlertConcluded: calls emailPort.send with correct to and subject', async () => {
    await adapter.sendAlertConcluded(
      {
        alertId: 'alert-1',
        organizationId: 'org-1',
        actorId: 'actor-1',
        fromStatus: 'ANALYZING',
        note: null,
        concludedAt: new Date().toISOString(),
      },
      ctx,
    );

    expect(emailPort.send).toHaveBeenCalledOnce();
    const call = (emailPort.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      to: string;
      subject: string;
      html: string;
    };
    expect(call.to).toBe('compliance@acme.com');
    expect(call.subject).toBe('Alert concluded: Test Alert Title');
    expect(call.html).toContain('Alert concluded');
    expect(call.html).toContain('Jane Doe'); // actorName
  });

  // ── sendAlertStatusChanged ─────────────────────────────────────────────────

  it('sendAlertStatusChanged: calls emailPort.send with correct to and subject', async () => {
    await adapter.sendAlertStatusChanged(
      {
        alertId: 'alert-1',
        organizationId: 'org-1',
        actorId: 'actor-1',
        fromStatus: 'NEW',
        toStatus: 'TRIAGING',
        note: null,
        changedAt: new Date().toISOString(),
      },
      ctx,
    );

    expect(emailPort.send).toHaveBeenCalledOnce();
    const call = (emailPort.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      to: string;
      subject: string;
      html: string;
    };
    expect(call.to).toBe('compliance@acme.com');
    expect(call.subject).toBe('Alert status changed: Test Alert Title');
    expect(call.html).toContain('TRIAGING');
  });

  // ── sendAlertAssigned ──────────────────────────────────────────────────────

  it('sendAlertAssigned: calls emailPort.send with correct to and subject', async () => {
    await adapter.sendAlertAssigned(
      {
        alertId: 'alert-1',
        organizationId: 'org-1',
        actorId: 'actor-1',
        assigneeId: 'assignee-1',
        assignedAt: new Date().toISOString(),
      },
      ctx,
    );

    expect(emailPort.send).toHaveBeenCalledOnce();
    const call = (emailPort.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      to: string;
      subject: string;
      html: string;
    };
    expect(call.to).toBe('compliance@acme.com');
    expect(call.subject).toBe('Alert assigned: Test Alert Title');
    expect(call.html).toContain('John Smith'); // assigneeName
  });

  it('sendAlertAssigned: uses "Unassigned" when assigneeName is null', async () => {
    const unassignedCtx = { ...ctx, assigneeName: null };

    await adapter.sendAlertAssigned(
      {
        alertId: 'alert-1',
        organizationId: 'org-1',
        actorId: 'actor-1',
        assigneeId: null,
        assignedAt: new Date().toISOString(),
      },
      unassignedCtx,
    );

    const call = (emailPort.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      html: string;
    };
    expect(call.html).toContain('Unassigned');
  });
});
