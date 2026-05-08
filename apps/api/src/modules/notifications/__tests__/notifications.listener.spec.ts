/**
 * Unit tests for `NotificationsListenerService`.
 *
 * sdd/notify-slack/spec:
 *  - dedup guard: toStatus === 'CONCLUDED' → return early, port NOT called
 *  - unconfigured org (repo returns null channel) → no port call, no error
 *  - each of 3 events triggers the correct port method with correct ctx
 *
 * NO `pnpm build` after changes (project rule).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationsListenerService } from '../notifications.listener.service.js';
import type { NotificationPort, NotificationContext } from '@regwatch/types';
import type { PrismaClient } from '@regwatch/db/client';

// ─── Mock context ─────────────────────────────────────────────────────────────

const mockCtx: NotificationContext = {
  alertId: 'alert-1',
  alertTitle: 'Test Alert',
  alertUrl: 'http://localhost:3000/alerts/alert-1',
  orgName: 'Test Org',
  actorName: 'Actor User',
  assigneeName: null,
  webhookUrl: 'https://hooks.slack.com/test',
};

// ─── Prisma mock factory ───────────────────────────────────────────────────────

function makePrisma(
  overrides: Partial<{
    channelRow: { webhookUrl: string; isActive: boolean } | null;
  }> = {},
) {
  const channelRow = Object.prototype.hasOwnProperty.call(overrides, 'channelRow')
    ? overrides.channelRow
    : { webhookUrl: mockCtx.webhookUrl, isActive: true };

  const alertRow = { title: mockCtx.alertTitle, sourceUrl: 'https://example.com' };
  const actorRow = { name: mockCtx.actorName, email: 'actor@test.local' };
  const orgRow = { name: mockCtx.orgName };

  return {
    notificationChannel: {
      findUnique: vi.fn().mockResolvedValue(channelRow),
    },
    alert: {
      findUnique: vi.fn().mockResolvedValue(alertRow),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(actorRow),
    },
    organization: {
      findUnique: vi.fn().mockResolvedValue(orgRow),
    },
  } as unknown as PrismaClient;
}

// ─── Port mock ────────────────────────────────────────────────────────────────

function makePort(): NotificationPort {
  return {
    sendAlertConcluded: vi.fn().mockResolvedValue(undefined),
    sendAlertStatusChanged: vi.fn().mockResolvedValue(undefined),
    sendAlertAssigned: vi.fn().mockResolvedValue(undefined),
  };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

function makeService(prisma: PrismaClient, port: NotificationPort) {
  // Construct bypassing NestJS DI — inject tokens manually
  const service = new (NotificationsListenerService as unknown as new (
    prisma: PrismaClient,
    port: NotificationPort,
  ) => NotificationsListenerService)(prisma, port);
  return service;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NotificationsListenerService', () => {
  let port: NotificationPort;
  let prisma: PrismaClient;
  let service: NotificationsListenerService;

  beforeEach(() => {
    port = makePort();
    prisma = makePrisma();
    service = makeService(prisma, port);
  });

  // ── dedup guard ─────────────────────────────────────────────────────────────

  it('onAlertStatusChanged: toStatus === CONCLUDED → returns early, port NOT called', async () => {
    await service.onAlertStatusChanged({
      alertId: 'alert-1',
      organizationId: 'org-1',
      actorId: 'actor-1',
      fromStatus: 'ANALYZING',
      toStatus: 'CONCLUDED',
      note: null,
      changedAt: new Date().toISOString(),
    });

    expect(port.sendAlertStatusChanged).not.toHaveBeenCalled();
    expect(prisma.notificationChannel.findUnique).not.toHaveBeenCalled();
  });

  // ── unconfigured org ────────────────────────────────────────────────────────

  it('onAlertConcluded: no channel configured → no port call, no error', async () => {
    prisma = makePrisma({ channelRow: null });
    service = makeService(prisma, port);

    await expect(
      service.onAlertConcluded({
        alertId: 'alert-1',
        organizationId: 'org-1',
        actorId: 'actor-1',
        fromStatus: 'ANALYZING',
        note: null,
        concludedAt: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();

    expect(port.sendAlertConcluded).not.toHaveBeenCalled();
  });

  it('onAlertConcluded: isActive=false → no port call', async () => {
    prisma = makePrisma({
      channelRow: { webhookUrl: 'https://hooks.slack.com/test', isActive: false },
    });
    service = makeService(prisma, port);

    await service.onAlertConcluded({
      alertId: 'alert-1',
      organizationId: 'org-1',
      actorId: 'actor-1',
      fromStatus: 'ANALYZING',
      note: null,
      concludedAt: new Date().toISOString(),
    });

    expect(port.sendAlertConcluded).not.toHaveBeenCalled();
  });

  // ── event routing ───────────────────────────────────────────────────────────

  it('onAlertConcluded: configured org → calls sendAlertConcluded', async () => {
    const payload = {
      alertId: 'alert-1',
      organizationId: 'org-1',
      actorId: 'actor-1',
      fromStatus: 'ANALYZING',
      note: null,
      concludedAt: new Date().toISOString(),
    };

    await service.onAlertConcluded(payload);

    expect(port.sendAlertConcluded).toHaveBeenCalledOnce();
    const [calledPayload, calledCtx] = (port.sendAlertConcluded as ReturnType<typeof vi.fn>).mock
      .calls[0] as [typeof payload, NotificationContext];
    expect(calledPayload.alertId).toBe('alert-1');
    expect(calledCtx.alertTitle).toBe(mockCtx.alertTitle);
    expect(calledCtx.webhookUrl).toBe(mockCtx.webhookUrl);
  });

  it('onAlertStatusChanged: toStatus !== CONCLUDED → calls sendAlertStatusChanged', async () => {
    const payload = {
      alertId: 'alert-1',
      organizationId: 'org-1',
      actorId: 'actor-1',
      fromStatus: 'NEW',
      toStatus: 'TRIAGING',
      note: null,
      changedAt: new Date().toISOString(),
    };

    await service.onAlertStatusChanged(payload);

    expect(port.sendAlertStatusChanged).toHaveBeenCalledOnce();
  });

  it('onAlertAssigned: configured org → calls sendAlertAssigned', async () => {
    const payload = {
      alertId: 'alert-1',
      organizationId: 'org-1',
      actorId: 'actor-1',
      assigneeId: 'assignee-1',
      assignedAt: new Date().toISOString(),
    };

    await service.onAlertAssigned(payload);

    expect(port.sendAlertAssigned).toHaveBeenCalledOnce();
  });

  it('onAlertAssigned: assigneeId null → ctx.assigneeName is null', async () => {
    const payload = {
      alertId: 'alert-1',
      organizationId: 'org-1',
      actorId: 'actor-1',
      assigneeId: null,
      assignedAt: new Date().toISOString(),
    };

    await service.onAlertAssigned(payload);

    expect(port.sendAlertAssigned).toHaveBeenCalledOnce();
    const [, ctx] = (port.sendAlertAssigned as ReturnType<typeof vi.fn>).mock.calls[0] as [
      unknown,
      NotificationContext,
    ];
    expect(ctx.assigneeName).toBeNull();
  });

  it('port error → caught, logged, not rethrown (fire-and-forget)', async () => {
    vi.spyOn(port, 'sendAlertConcluded').mockRejectedValue(new Error('Slack 500'));

    await expect(
      service.onAlertConcluded({
        alertId: 'alert-1',
        organizationId: 'org-1',
        actorId: 'actor-1',
        fromStatus: 'ANALYZING',
        note: null,
        concludedAt: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined(); // must not throw
  });
});
