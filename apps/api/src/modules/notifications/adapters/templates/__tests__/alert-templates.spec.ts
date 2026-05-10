/**
 * Tests for alert email templates.
 *
 * sdd/notify-email-resend (POST-2) — task 7.3.
 *
 * Asserts subject string and key HTML nodes for each template function.
 * Uses inline snapshots for subject lines; asserts key content for HTML.
 *
 * NO `pnpm build` after changes (project rule).
 */

import { describe, it, expect } from 'vitest';
import { alertConcludedTemplate } from '../alert-concluded.template.js';
import { alertStatusChangedTemplate } from '../alert-status-changed.template.js';
import { alertAssignedTemplate } from '../alert-assigned.template.js';
import type { NotificationContext } from '@regwatch/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ctx: NotificationContext = {
  alertId: 'alert-1',
  alertTitle: 'BCRA Resolution 123',
  alertUrl: 'http://localhost:3000/alerts/alert-1',
  orgName: 'Acme Corp',
  actorName: 'Jane Doe',
  assigneeName: 'John Smith',
  webhookUrl: 'compliance@acme.com',
  recipientEmail: 'compliance@acme.com',
};

const basePayload = {
  alertId: 'alert-1',
  organizationId: 'org-1',
  actorId: 'actor-1',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('alertConcludedTemplate', () => {
  it('returns correct subject', () => {
    const { subject } = alertConcludedTemplate(
      {
        ...basePayload,
        fromStatus: 'ANALYZING',
        note: null,
        concludedAt: new Date().toISOString(),
      },
      ctx,
    );
    expect(subject).toBe('Alert concluded: BCRA Resolution 123');
  });

  it('HTML contains alertTitle, alertUrl, and actorName', () => {
    const { html } = alertConcludedTemplate(
      {
        ...basePayload,
        fromStatus: 'ANALYZING',
        note: null,
        concludedAt: new Date().toISOString(),
      },
      ctx,
    );
    expect(html).toContain('BCRA Resolution 123');
    expect(html).toContain('http://localhost:3000/alerts/alert-1');
    expect(html).toContain('Jane Doe');
  });

  it('text contains alertTitle and actorName', () => {
    const { text } = alertConcludedTemplate(
      {
        ...basePayload,
        fromStatus: 'ANALYZING',
        note: null,
        concludedAt: new Date().toISOString(),
      },
      ctx,
    );
    expect(text).toContain('BCRA Resolution 123');
    expect(text).toContain('Jane Doe');
  });
});

describe('alertStatusChangedTemplate', () => {
  it('returns correct subject', () => {
    const { subject } = alertStatusChangedTemplate(
      {
        ...basePayload,
        fromStatus: 'NEW',
        toStatus: 'TRIAGING',
        note: null,
        changedAt: new Date().toISOString(),
      },
      ctx,
    );
    expect(subject).toBe('Alert status changed: BCRA Resolution 123');
  });

  it('HTML contains toStatus, alertTitle, and actorName', () => {
    const { html } = alertStatusChangedTemplate(
      {
        ...basePayload,
        fromStatus: 'NEW',
        toStatus: 'TRIAGING',
        note: null,
        changedAt: new Date().toISOString(),
      },
      ctx,
    );
    expect(html).toContain('TRIAGING');
    expect(html).toContain('BCRA Resolution 123');
    expect(html).toContain('Jane Doe');
  });
});

describe('alertAssignedTemplate', () => {
  it('returns correct subject', () => {
    const { subject } = alertAssignedTemplate(
      { ...basePayload, assigneeId: 'assignee-1', assignedAt: new Date().toISOString() },
      ctx,
    );
    expect(subject).toBe('Alert assigned: BCRA Resolution 123');
  });

  it('HTML contains assigneeName, alertTitle, and actorName', () => {
    const { html } = alertAssignedTemplate(
      { ...basePayload, assigneeId: 'assignee-1', assignedAt: new Date().toISOString() },
      ctx,
    );
    expect(html).toContain('John Smith'); // assigneeName
    expect(html).toContain('BCRA Resolution 123');
    expect(html).toContain('Jane Doe');
  });

  it('uses "Unassigned" when assigneeName is null', () => {
    const { html } = alertAssignedTemplate(
      { ...basePayload, assigneeId: null, assignedAt: new Date().toISOString() },
      { ...ctx, assigneeName: null },
    );
    expect(html).toContain('Unassigned');
  });
});
