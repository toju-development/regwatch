/**
 * Unit tests for `TeamsAdapter`.
 *
 * sdd/notify-teams (POST-1):
 *  - 8.1 sendAlertConcluded: MessageCard with themeColor "22c55e" + potentialAction
 *  - 8.2 sendAlertStatusChanged: STATUS_COLOR per AlertStatus value
 *  - 8.3 sendAlertAssigned: themeColor "3b82f6" + assigneeName in facts
 *  - 8.4 non-2xx → throws; HTTP 200 with body "1" → res.ok = true, no throw
 *
 * Uses global fetch mock (vi.stubGlobal).
 *
 * NO `pnpm build` after changes (project rule).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TeamsAdapter } from '../adapters/teams.adapter.js';
import type { NotificationContext } from '@regwatch/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WEBHOOK_URL = 'https://example.webhook.office.com/webhookb2/test';

const ctx: NotificationContext = {
  alertId: 'alert-1',
  alertTitle: 'New Regulation Test',
  alertUrl: 'http://localhost:3000/alerts/alert-1',
  orgName: 'Acme Corp',
  actorName: 'Jane Doe',
  assigneeName: 'John Smith',
  webhookUrl: WEBHOOK_URL,
};

function makeFetchOk(body = 'ok') {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue(body),
  });
}

function makeFetchFail(status = 500) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: vi.fn().mockResolvedValue('Internal Server Error'),
  });
}

interface MessageCard {
  '@type': string;
  themeColor: string;
  summary: string;
  sections: Array<{
    activityTitle: string;
    facts: Array<{ name: string; value: string }>;
  }>;
  potentialAction?: Array<{
    '@type': string;
    name: string;
    targets: Array<{ uri: string }>;
  }>;
}

function parseCard(fetchMock: ReturnType<typeof vi.fn>): MessageCard {
  const [, options] = fetchMock.mock.calls[0]! as [string, RequestInit];
  return JSON.parse(options.body as string) as MessageCard;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TeamsAdapter', () => {
  let adapter: TeamsAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new TeamsAdapter();
    fetchMock = makeFetchOk();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── 8.1: sendAlertConcluded ─────────────────────────────────────────────────

  it('8.1: sendAlertConcluded: POSTs MessageCard with themeColor "22c55e" and potentialAction', async () => {
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
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(WEBHOOK_URL);

    const card = parseCard(fetchMock);
    expect(card['@type']).toBe('MessageCard');
    expect(card.themeColor).toBe('22c55e');
    expect(card.potentialAction).toHaveLength(1);
    expect(card.potentialAction![0]!.targets[0]!.uri).toBe(ctx.alertUrl);

    // Actor fact is present
    const facts = card.sections[0]!.facts;
    expect(facts.some((f) => f.value === ctx.actorName)).toBe(true);
  });

  // ── 8.2: sendAlertStatusChanged — STATUS_COLORS ─────────────────────────────

  it.each([
    ['NEW', '94a3b8'],
    ['TRIAGING', 'f59e0b'],
    ['ANALYZING', '3b82f6'],
    ['DEBATING', '8b5cf6'],
    ['CONCLUDED', '22c55e'],
    ['DISTRIBUTED', '10b981'],
    ['ARCHIVED', '6b7280'],
  ])('8.2: sendAlertStatusChanged(%s) uses themeColor %s', async (toStatus, expectedColor) => {
    await adapter.sendAlertStatusChanged(
      {
        alertId: 'alert-1',
        organizationId: 'org-1',
        actorId: 'actor-1',
        fromStatus: 'NEW',
        toStatus: toStatus as import('@regwatch/types').AlertStatus,
        note: null,
        changedAt: new Date().toISOString(),
      },
      ctx,
    );

    const card = parseCard(fetchMock);
    expect(card.themeColor).toBe(expectedColor);
    expect(card.sections[0]!.facts.some((f) => f.value === toStatus)).toBe(true);
  });

  // ── 8.3: sendAlertAssigned ──────────────────────────────────────────────────

  it('8.3: sendAlertAssigned: themeColor "3b82f6" and assigneeName in facts', async () => {
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

    const card = parseCard(fetchMock);
    expect(card.themeColor).toBe('3b82f6');
    const facts = card.sections[0]!.facts;
    expect(facts.some((f) => f.value === ctx.assigneeName)).toBe(true);
  });

  it('8.3b: sendAlertAssigned with null assigneeName → "Unassigned" in facts', async () => {
    await adapter.sendAlertAssigned(
      {
        alertId: 'alert-1',
        organizationId: 'org-1',
        actorId: 'actor-1',
        assigneeId: null,
        assignedAt: new Date().toISOString(),
      },
      { ...ctx, assigneeName: null },
    );

    const card = parseCard(fetchMock);
    const facts = card.sections[0]!.facts;
    expect(facts.some((f) => f.value === 'Unassigned')).toBe(true);
  });

  // ── 8.4: HTTP failure + "1" body ────────────────────────────────────────────

  it('8.4a: non-2xx response → throws', async () => {
    vi.stubGlobal('fetch', makeFetchFail(400));

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
    ).rejects.toThrow('400');
  });

  it('8.4b: HTTP 200 with body "1" → res.ok is true, no throw', async () => {
    vi.stubGlobal('fetch', makeFetchOk('1'));

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
    ).resolves.toBeUndefined();
  });
});
