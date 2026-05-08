/**
 * Unit tests for `SlackAdapter`.
 *
 * sdd/notify-slack/spec R "Slack Adapter (Block Kit)":
 *  - sendAlertConcluded: correct color, text, action link, webhookUrl target
 *  - sendAlertStatusChanged: status-bucket color, correct text
 *  - sendAlertAssigned: blue color, assignee name / Unassigned fallback
 *  - Non-2xx Slack response → throws
 *
 * Uses global fetch mock (vi.stubGlobal).
 *
 * NO `pnpm build` after changes (project rule).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlackAdapter } from '../adapters/slack.adapter.js';
import type { NotificationContext } from '@regwatch/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WEBHOOK_URL = 'https://hooks.slack.com/services/test';

const ctx: NotificationContext = {
  alertId: 'alert-1',
  alertTitle: 'New Regulation Test',
  alertUrl: 'http://localhost:3000/alerts/alert-1',
  orgName: 'Acme Corp',
  actorName: 'Jane Doe',
  assigneeName: 'John Smith',
  webhookUrl: WEBHOOK_URL,
};

function makeFetchOk() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue('ok'),
  });
}

function makeFetchFail(status = 500) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: vi.fn().mockResolvedValue('Internal Server Error'),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SlackAdapter', () => {
  let adapter: SlackAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new SlackAdapter();
    fetchMock = makeFetchOk();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── sendAlertConcluded ─────────────────────────────────────────────────────

  it('sendAlertConcluded: POSTs to webhookUrl with green color and view-alert action', async () => {
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

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(WEBHOOK_URL);

    const body = JSON.parse(options.body as string) as {
      attachments: Array<{ color: string; text: string; actions: Array<{ url: string }> }>;
    };
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0]!.color).toBe('#22c55e');
    expect(body.attachments[0]!.text).toContain('Alert concluded');
    expect(body.attachments[0]!.text).toContain('Jane Doe');
    expect(body.attachments[0]!.actions[0]!.url).toBe(ctx.alertUrl);
  });

  // ── sendAlertStatusChanged ─────────────────────────────────────────────────

  it('sendAlertStatusChanged: uses status-bucket color for TRIAGING', async () => {
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

    const body = JSON.parse(
      (fetchMock.mock.calls[0]! as [string, RequestInit])[1].body as string,
    ) as { attachments: Array<{ color: string; text: string }> };

    expect(body.attachments[0]!.color).toBe('#f59e0b'); // amber for TRIAGING
    expect(body.attachments[0]!.text).toContain('TRIAGING');
  });

  // ── sendAlertAssigned ──────────────────────────────────────────────────────

  it('sendAlertAssigned: includes assignee name in text', async () => {
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

    const body = JSON.parse(
      (fetchMock.mock.calls[0]! as [string, RequestInit])[1].body as string,
    ) as { attachments: Array<{ color: string; text: string }> };

    expect(body.attachments[0]!.color).toBe('#3b82f6');
    expect(body.attachments[0]!.text).toContain('John Smith');
  });

  it('sendAlertAssigned: null assigneeName → "Unassigned"', async () => {
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

    const body = JSON.parse(
      (fetchMock.mock.calls[0]! as [string, RequestInit])[1].body as string,
    ) as { attachments: Array<{ text: string }> };
    expect(body.attachments[0]!.text).toContain('Unassigned');
  });

  // ── non-2xx error ──────────────────────────────────────────────────────────

  it('throws when Slack returns non-2xx', async () => {
    vi.stubGlobal('fetch', makeFetchFail(500));

    await expect(
      adapter.sendAlertConcluded(
        {
          alertId: 'alert-1',
          organizationId: 'org-1',
          actorId: 'actor-1',
          fromStatus: 'ANALYZING',
          note: null,
          concludedAt: new Date().toISOString(),
        },
        ctx,
      ),
    ).rejects.toThrow('500');
  });
});
