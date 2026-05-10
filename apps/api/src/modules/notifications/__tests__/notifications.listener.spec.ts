/**
 * Unit tests for `NotificationsListenerService`.
 *
 * sdd/notify-teams (POST-1):
 *  - 8.7 org with SLACK + TEAMS channels → both adapters called with correct webhookUrls
 *  - 8.8 channel with unknown provider → silently skipped, no error
 *  - 8.9 TEAMS channel out of jurisdiction → not dispatched
 *  - 8.10 all pre-existing Slack listener tests pass without modification
 *
 * sdd/segmented-distribution (MVP-14):
 *  - 6.1 catch-all channel (jurisdictions=[]) receives every alert
 *  - 6.2 filtered channel receives only matching effectiveJurisdiction
 *  - 6.3 filtered channel ignores non-matching jurisdiction
 *  - 6.4 effectiveJurisdiction resolves via scanLog.jurisdiction when alert.jurisdiction=null
 *  - 6.5 null effectiveJurisdiction (no scanLog) reaches only catch-all channels
 *  - 6.6 zero matching channels: adapter.send* never called, DISTRIBUTED not emitted
 *  - 6.7 all channels fail Promise.allSettled: DISTRIBUTED not emitted
 *  - 6.8 one channel fulfills, one rejects: DISTRIBUTED emitted exactly once
 *
 * sdd/notify-slack/spec (legacy):
 *  - dedup guard: toStatus === 'CONCLUDED' → return early, adapter NOT called
 *  - dedup guard: toStatus === 'DISTRIBUTED' → return early (prevent recursion)
 *  - unconfigured org (repo returns [] channels) → no adapter call, no error
 *  - each of 3 events triggers the correct adapter method with correct ctx
 *
 * NO `pnpm build` after changes (project rule).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationsListenerService } from '../notifications.listener.service.js';
import type { NotificationPort, NotificationContext, AlertStatus } from '@regwatch/types';
import type { PrismaClient } from '@regwatch/db/client';
import type { NotificationsRepo } from '../notifications.repository.js';
import type { NotificationAdapterRegistry } from '../notification-adapter.registry.js';
import { EventEmitter2 } from '@nestjs/event-emitter';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WEBHOOK_A = 'https://hooks.slack.com/A';
const WEBHOOK_B = 'https://teams.webhook.office.com/B';

function makeChannel(
  overrides: {
    id?: string;
    webhookUrl?: string;
    channelName?: string | null;
    provider?: string;
    jurisdictions?: string[];
  } = {},
) {
  return {
    id: overrides.id ?? 'chan-1',
    webhookUrl: overrides.webhookUrl ?? WEBHOOK_A,
    channelName: overrides.channelName ?? null,
    provider: overrides.provider ?? 'SLACK',
    jurisdictions: overrides.jurisdictions ?? [],
  };
}

// ─── Prisma mock factory ───────────────────────────────────────────────────────

function makePrisma(
  overrides: {
    alertJurisdiction?: string | null;
    scanLogJurisdiction?: string | null;
    hasScanLog?: boolean;
  } = {},
) {
  const alertJurisdiction = Object.prototype.hasOwnProperty.call(overrides, 'alertJurisdiction')
    ? overrides.alertJurisdiction
    : null;
  const hasScanLog = overrides.hasScanLog ?? false;
  const scanLogJurisdiction = overrides.scanLogJurisdiction ?? null;

  const scanLog = hasScanLog ? { jurisdiction: scanLogJurisdiction } : null;

  return {
    alert: {
      findUnique: vi.fn().mockResolvedValue({
        title: 'Test Alert',
        sourceUrl: 'https://example.com',
        jurisdiction: alertJurisdiction,
        scanLog,
      }),
      update: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ name: 'Actor User', email: 'actor@test.local' }),
    },
    organization: {
      findUnique: vi.fn().mockResolvedValue({ name: 'Test Org' }),
    },
  } as unknown as PrismaClient;
}

// ─── Repo mock factory ─────────────────────────────────────────────────────────

function makeRepo(channels: ReturnType<typeof makeChannel>[] = [makeChannel()]) {
  return {
    findAllActiveChannels: vi.fn().mockResolvedValue(channels),
  } as unknown as NotificationsRepo;
}

// ─── Adapter mocks ────────────────────────────────────────────────────────────

function makeAdapter(): NotificationPort {
  return {
    sendAlertConcluded: vi.fn().mockResolvedValue(undefined),
    sendAlertStatusChanged: vi.fn().mockResolvedValue(undefined),
    sendAlertAssigned: vi.fn().mockResolvedValue(undefined),
  };
}

// ─── Registry mock factory ─────────────────────────────────────────────────────

function makeRegistry(
  slack: NotificationPort,
  teams: NotificationPort,
): NotificationAdapterRegistry {
  return {
    get: vi.fn((provider: string) => {
      if (provider === 'SLACK') return slack;
      if (provider === 'TEAMS') return teams;
      return undefined;
    }),
  } as unknown as NotificationAdapterRegistry;
}

// ─── EventEmitter2 mock ───────────────────────────────────────────────────────

function makeEvents() {
  return {
    emit: vi.fn(),
  } as unknown as EventEmitter2;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

function makeService(
  prisma: PrismaClient,
  registry: NotificationAdapterRegistry,
  repo: NotificationsRepo,
  events: EventEmitter2,
) {
  return new (NotificationsListenerService as unknown as new (
    prisma: PrismaClient,
    registry: NotificationAdapterRegistry,
    repo: NotificationsRepo,
    events: EventEmitter2,
  ) => NotificationsListenerService)(prisma, registry, repo, events);
}

// ─── Shared event payload builders ────────────────────────────────────────────

function statusChangedPayload(toStatus: AlertStatus = 'TRIAGING') {
  return {
    alertId: 'alert-1',
    organizationId: 'org-1',
    actorId: 'actor-1',
    fromStatus: 'NEW' as AlertStatus,
    toStatus,
    note: null,
    changedAt: new Date().toISOString(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NotificationsListenerService', () => {
  let slackAdapter: NotificationPort;
  let teamsAdapter: NotificationPort;
  let registry: NotificationAdapterRegistry;
  let prisma: PrismaClient;
  let repo: NotificationsRepo;
  let events: EventEmitter2;
  let service: NotificationsListenerService;

  beforeEach(() => {
    slackAdapter = makeAdapter();
    teamsAdapter = makeAdapter();
    registry = makeRegistry(slackAdapter, teamsAdapter);
    prisma = makePrisma();
    repo = makeRepo();
    events = makeEvents();
    service = makeService(prisma, registry, repo, events);
  });

  // ── dedup guards ─────────────────────────────────────────────────────────────

  it('onAlertStatusChanged: toStatus === CONCLUDED → returns early, adapter NOT called', async () => {
    await service.onAlertStatusChanged(statusChangedPayload('CONCLUDED'));
    expect(registry.get).not.toHaveBeenCalled();
    expect(repo.findAllActiveChannels).not.toHaveBeenCalled();
  });

  it('onAlertStatusChanged: toStatus === DISTRIBUTED → returns early (recursion guard)', async () => {
    await service.onAlertStatusChanged(statusChangedPayload('DISTRIBUTED'));
    expect(registry.get).not.toHaveBeenCalled();
    expect(repo.findAllActiveChannels).not.toHaveBeenCalled();
  });

  // ── 6.1: catch-all channel receives every alert ───────────────────────────

  it('6.1: catch-all channel (jurisdictions=[]) receives alert with any effectiveJurisdiction', async () => {
    repo = makeRepo([makeChannel({ jurisdictions: [] })]);
    prisma = makePrisma({ alertJurisdiction: 'AR' });
    service = makeService(prisma, registry, repo, events);

    await service.onAlertStatusChanged(statusChangedPayload());

    expect(slackAdapter.sendAlertStatusChanged).toHaveBeenCalledOnce();
  });

  it('6.1b: catch-all channel receives alert when effectiveJurisdiction is null', async () => {
    repo = makeRepo([makeChannel({ jurisdictions: [] })]);
    prisma = makePrisma({ alertJurisdiction: null, hasScanLog: false });
    (prisma.alert.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ title: 'T', sourceUrl: 'u', jurisdiction: null, scanLog: null })
      .mockResolvedValue({ status: 'TRIAGING' });
    service = makeService(prisma, registry, repo, events);

    await service.onAlertStatusChanged(statusChangedPayload());

    expect(slackAdapter.sendAlertStatusChanged).toHaveBeenCalledOnce();
  });

  // ── 6.2: filtered channel receives only matching jurisdiction ─────────────

  it('6.2: filtered channel (jurisdictions=["AR"]) receives alert with effectiveJurisdiction="AR"', async () => {
    repo = makeRepo([makeChannel({ jurisdictions: ['AR'] })]);
    prisma = makePrisma({ alertJurisdiction: 'AR' });
    (prisma.alert.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ title: 'T', sourceUrl: 'u', jurisdiction: 'AR', scanLog: null })
      .mockResolvedValue({ status: 'TRIAGING' });
    service = makeService(prisma, registry, repo, events);

    await service.onAlertStatusChanged(statusChangedPayload());

    expect(slackAdapter.sendAlertStatusChanged).toHaveBeenCalledOnce();
    const [, ctx] = (slackAdapter.sendAlertStatusChanged as ReturnType<typeof vi.fn>).mock
      .calls[0] as [unknown, NotificationContext];
    expect(ctx.webhookUrl).toBe(WEBHOOK_A);
  });

  // ── 6.3: filtered channel ignores non-matching jurisdiction ───────────────

  it('6.3: filtered channel (jurisdictions=["AR"]) ignores alert with effectiveJurisdiction="UY"', async () => {
    repo = makeRepo([makeChannel({ jurisdictions: ['AR'] })]);
    prisma = makePrisma({ alertJurisdiction: 'UY' });
    (prisma.alert.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: 'T',
      sourceUrl: 'u',
      jurisdiction: 'UY',
      scanLog: null,
    });
    service = makeService(prisma, registry, repo, events);

    await service.onAlertStatusChanged(statusChangedPayload());

    expect(slackAdapter.sendAlertStatusChanged).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  // ── 6.4: effectiveJurisdiction resolves via scanLog ───────────────────────

  it('6.4: effectiveJurisdiction resolved via scanLog.jurisdiction when alert.jurisdiction=null', async () => {
    repo = makeRepo([makeChannel({ jurisdictions: ['AR'] })]);
    prisma = makePrisma({ alertJurisdiction: null, hasScanLog: true, scanLogJurisdiction: 'AR' });
    (prisma.alert.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        title: 'T',
        sourceUrl: 'u',
        jurisdiction: null,
        scanLog: { jurisdiction: 'AR' },
      })
      .mockResolvedValue({ status: 'TRIAGING' });
    service = makeService(prisma, registry, repo, events);

    await service.onAlertStatusChanged(statusChangedPayload());

    expect(slackAdapter.sendAlertStatusChanged).toHaveBeenCalledOnce();
  });

  // ── 6.5: null effectiveJurisdiction reaches only catch-all channels ────────

  it('6.5: null effectiveJurisdiction (no scanLog) reaches only catch-all channels', async () => {
    repo = makeRepo([
      makeChannel({ id: 'c1', webhookUrl: WEBHOOK_A, jurisdictions: [] }), // catch-all
      makeChannel({ id: 'c2', webhookUrl: WEBHOOK_B, jurisdictions: ['AR'] }), // filtered
    ]);
    (prisma.alert.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ title: 'T', sourceUrl: 'u', jurisdiction: null, scanLog: null })
      .mockResolvedValue({ status: 'TRIAGING' });
    service = makeService(prisma, registry, repo, events);

    await service.onAlertStatusChanged(statusChangedPayload());

    expect(slackAdapter.sendAlertStatusChanged).toHaveBeenCalledOnce();
    const [, ctx] = (slackAdapter.sendAlertStatusChanged as ReturnType<typeof vi.fn>).mock
      .calls[0] as [unknown, NotificationContext];
    expect(ctx.webhookUrl).toBe(WEBHOOK_A);
  });

  // ── 6.6: zero matching channels → adapter never called, DISTRIBUTED not emitted

  it('6.6: zero matching channels → adapter.sendAlertStatusChanged not called, DISTRIBUTED not emitted', async () => {
    repo = makeRepo([makeChannel({ jurisdictions: ['AR'] })]);
    (prisma.alert.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: 'T',
      sourceUrl: 'u',
      jurisdiction: 'UY',
      scanLog: null,
    });
    service = makeService(prisma, registry, repo, events);

    await service.onAlertStatusChanged(statusChangedPayload());

    expect(slackAdapter.sendAlertStatusChanged).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  // ── 6.7: all channels fail → DISTRIBUTED not emitted ─────────────────────

  it('6.7: all channel calls fail → DISTRIBUTED not emitted', async () => {
    repo = makeRepo([makeChannel({ jurisdictions: [] })]);
    vi.spyOn(slackAdapter, 'sendAlertStatusChanged').mockRejectedValue(new Error('Slack 500'));
    (prisma.alert.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: 'T',
      sourceUrl: 'u',
      jurisdiction: null,
      scanLog: null,
    });
    service = makeService(prisma, registry, repo, events);

    await service.onAlertStatusChanged(statusChangedPayload());

    expect(events.emit).not.toHaveBeenCalled();
  });

  // ── 6.8: one channel fulfills, one rejects → DISTRIBUTED emitted once ──────

  it('6.8: one channel fulfills, one rejects → DISTRIBUTED emitted exactly once', async () => {
    repo = makeRepo([
      makeChannel({ id: 'c1', webhookUrl: WEBHOOK_A, jurisdictions: [] }),
      makeChannel({ id: 'c2', webhookUrl: WEBHOOK_B, jurisdictions: [] }),
    ]);
    (slackAdapter.sendAlertStatusChanged as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined) // c1 fulfills
      .mockRejectedValueOnce(new Error('fail')); // c2 rejects

    (prisma.alert.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ title: 'T', sourceUrl: 'u', jurisdiction: null, scanLog: null })
      .mockResolvedValue({ status: 'TRIAGING' }); // for emitDistributed check

    service = makeService(prisma, registry, repo, events);

    await service.onAlertStatusChanged(statusChangedPayload());

    expect(events.emit).toHaveBeenCalledOnce();
    const emitCall = (events.emit as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown];
    expect(emitCall[0]).toBe('alert.status.changed');
    const evt = emitCall[1] as { toStatus: string };
    expect(evt.toStatus).toBe('DISTRIBUTED');
  });

  // ── unconfigured org (no active channels) ────────────────────────────────────

  it('onAlertConcluded: no active channels → no adapter call, no error', async () => {
    repo = makeRepo([]);
    service = makeService(prisma, registry, repo, events);

    await expect(
      service.onAlertConcluded({
        alertId: 'alert-1',
        organizationId: 'org-1',
        actorId: 'actor-1',
        fromStatus: 'ANALYZING' as AlertStatus,
        note: null,
        concludedAt: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();

    expect(slackAdapter.sendAlertConcluded).not.toHaveBeenCalled();
  });

  // ── event routing ───────────────────────────────────────────────────────────

  it('onAlertConcluded: configured org → calls sendAlertConcluded', async () => {
    repo = makeRepo([makeChannel({ jurisdictions: [] })]);
    service = makeService(prisma, registry, repo, events);

    const payload = {
      alertId: 'alert-1',
      organizationId: 'org-1',
      actorId: 'actor-1',
      fromStatus: 'ANALYZING' as AlertStatus,
      note: null,
      concludedAt: new Date().toISOString(),
    };

    await service.onAlertConcluded(payload);

    expect(slackAdapter.sendAlertConcluded).toHaveBeenCalledOnce();
    const [, ctx] = (slackAdapter.sendAlertConcluded as ReturnType<typeof vi.fn>).mock.calls[0] as [
      typeof payload,
      NotificationContext,
    ];
    expect(ctx.alertTitle).toBe('Test Alert');
    expect(ctx.webhookUrl).toBe(WEBHOOK_A);
  });

  it('onAlertStatusChanged: toStatus !== CONCLUDED → calls sendAlertStatusChanged', async () => {
    repo = makeRepo([makeChannel({ jurisdictions: [] })]);
    (prisma.alert.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ title: 'T', sourceUrl: 'u', jurisdiction: null, scanLog: null })
      .mockResolvedValue({ status: 'TRIAGING' });
    service = makeService(prisma, registry, repo, events);

    await service.onAlertStatusChanged(statusChangedPayload('TRIAGING'));

    expect(slackAdapter.sendAlertStatusChanged).toHaveBeenCalledOnce();
  });

  it('onAlertAssigned: configured org → calls sendAlertAssigned', async () => {
    repo = makeRepo([makeChannel({ jurisdictions: [] })]);
    service = makeService(prisma, registry, repo, events);

    await service.onAlertAssigned({
      alertId: 'alert-1',
      organizationId: 'org-1',
      actorId: 'actor-1',
      assigneeId: 'assignee-1',
      assignedAt: new Date().toISOString(),
    });

    expect(slackAdapter.sendAlertAssigned).toHaveBeenCalledOnce();
  });

  it('onAlertAssigned: assigneeId null → ctx.assigneeName is null', async () => {
    repo = makeRepo([makeChannel({ jurisdictions: [] })]);
    service = makeService(prisma, registry, repo, events);

    await service.onAlertAssigned({
      alertId: 'alert-1',
      organizationId: 'org-1',
      actorId: 'actor-1',
      assigneeId: null,
      assignedAt: new Date().toISOString(),
    });

    expect(slackAdapter.sendAlertAssigned).toHaveBeenCalledOnce();
    const [, ctx] = (slackAdapter.sendAlertAssigned as ReturnType<typeof vi.fn>).mock.calls[0] as [
      unknown,
      NotificationContext,
    ];
    expect(ctx.assigneeName).toBeNull();
  });

  it('adapter error → caught, logged, not rethrown (fire-and-forget)', async () => {
    repo = makeRepo([makeChannel({ jurisdictions: [] })]);
    vi.spyOn(slackAdapter, 'sendAlertConcluded').mockRejectedValue(new Error('Slack 500'));
    service = makeService(prisma, registry, repo, events);

    await expect(
      service.onAlertConcluded({
        alertId: 'alert-1',
        organizationId: 'org-1',
        actorId: 'actor-1',
        fromStatus: 'ANALYZING' as AlertStatus,
        note: null,
        concludedAt: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined(); // must not throw
  });

  // ── 8.7: multi-provider fan-out ───────────────────────────────────────────

  it('8.7: org with SLACK + TEAMS channels → both adapters called with correct webhookUrls', async () => {
    const SLACK_HOOK = 'https://hooks.slack.com/services/test';
    const TEAMS_HOOK = 'https://teams.webhook.office.com/test';

    repo = makeRepo([
      makeChannel({ id: 'c1', webhookUrl: SLACK_HOOK, provider: 'SLACK', jurisdictions: [] }),
      makeChannel({ id: 'c2', webhookUrl: TEAMS_HOOK, provider: 'TEAMS', jurisdictions: [] }),
    ]);
    service = makeService(prisma, registry, repo, events);

    await service.onAlertConcluded({
      alertId: 'alert-1',
      organizationId: 'org-1',
      actorId: 'actor-1',
      fromStatus: 'ANALYZING' as AlertStatus,
      note: null,
      concludedAt: new Date().toISOString(),
    });

    expect(slackAdapter.sendAlertConcluded).toHaveBeenCalledOnce();
    const [, slackCtx] = (slackAdapter.sendAlertConcluded as ReturnType<typeof vi.fn>).mock
      .calls[0] as [unknown, NotificationContext];
    expect(slackCtx.webhookUrl).toBe(SLACK_HOOK);

    expect(teamsAdapter.sendAlertConcluded).toHaveBeenCalledOnce();
    const [, teamsCtx] = (teamsAdapter.sendAlertConcluded as ReturnType<typeof vi.fn>).mock
      .calls[0] as [unknown, NotificationContext];
    expect(teamsCtx.webhookUrl).toBe(TEAMS_HOOK);
  });

  // ── 8.8: unknown provider → silently skipped ─────────────────────────────

  it('8.8: channel with unknown provider → silently skipped, no error', async () => {
    repo = makeRepo([
      makeChannel({ id: 'c1', webhookUrl: WEBHOOK_A, provider: 'LEGACY', jurisdictions: [] }),
    ]);
    service = makeService(prisma, registry, repo, events);

    await expect(
      service.onAlertConcluded({
        alertId: 'alert-1',
        organizationId: 'org-1',
        actorId: 'actor-1',
        fromStatus: 'ANALYZING' as AlertStatus,
        note: null,
        concludedAt: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();

    expect(slackAdapter.sendAlertConcluded).not.toHaveBeenCalled();
    expect(teamsAdapter.sendAlertConcluded).not.toHaveBeenCalled();
  });

  // ── 8.9: TEAMS channel out of jurisdiction → not dispatched ──────────────

  it('8.9: TEAMS channel out of jurisdiction → not dispatched', async () => {
    repo = makeRepo([
      makeChannel({ id: 'c1', webhookUrl: WEBHOOK_B, provider: 'TEAMS', jurisdictions: ['AR'] }),
    ]);
    // Alert jurisdiction is UY — no match
    (prisma.alert.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: 'T',
      sourceUrl: 'u',
      jurisdiction: 'UY',
      scanLog: null,
    });
    service = makeService(prisma, registry, repo, events);

    await service.onAlertConcluded({
      alertId: 'alert-1',
      organizationId: 'org-1',
      actorId: 'actor-1',
      fromStatus: 'ANALYZING' as AlertStatus,
      note: null,
      concludedAt: new Date().toISOString(),
    });

    expect(teamsAdapter.sendAlertConcluded).not.toHaveBeenCalled();
  });
});
