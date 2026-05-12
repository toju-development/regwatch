/**
 * Integration smoke test: EMAIL channel fan-out via MemoryEmailAdapter.
 *
 * sdd/notify-email-resend (POST-2) — task 7.5.
 *
 * With EMAIL_TRANSPORT=memory, fires AlertConcludedEvent for an org with
 * an active EMAIL channel and asserts MemoryEmailAdapter captures one email
 * with the correct subject. No live Resend calls are made.
 *
 * NO `pnpm build` after changes (project rule).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationsListenerService } from '../notifications.listener.service.js';
import { NotificationAdapterRegistry } from '../notification-adapter.registry.js';
import { ResendEmailNotificationAdapter } from '../adapters/resend-email-notification.adapter.js';
import { MemoryEmailAdapter } from '../../email/memory-email.adapter.js';
import type { NotificationPort } from '@regwatch/types';
import type { PrismaClient } from '@regwatch/db/client';
import type { NotificationsRepo } from '../notifications.repository.js';
import { EventEmitter2 } from '@nestjs/event-emitter';

// ─── Build real adapter chain (MemoryEmailAdapter → ResendEmailNotificationAdapter) ──

function makeEmailAdapter(): MemoryEmailAdapter {
  return new MemoryEmailAdapter();
}

function makeEmailNotificationAdapter(
  emailAdapter: MemoryEmailAdapter,
): ResendEmailNotificationAdapter {
  return new (ResendEmailNotificationAdapter as unknown as new (
    ep: MemoryEmailAdapter,
  ) => ResendEmailNotificationAdapter)(emailAdapter);
}

function makeRegistry(email: NotificationPort): NotificationAdapterRegistry {
  const noopAdapter: NotificationPort = {
    sendAlertConcluded: vi.fn().mockResolvedValue(undefined),
    sendAlertStatusChanged: vi.fn().mockResolvedValue(undefined),
    sendAlertAssigned: vi.fn().mockResolvedValue(undefined),
  };

  return new (NotificationAdapterRegistry as unknown as new (
    slack: NotificationPort,
    teams: NotificationPort,
    emailAdp: NotificationPort,
  ) => NotificationAdapterRegistry)(noopAdapter, noopAdapter, email);
}

function makePrisma(): PrismaClient {
  return {
    alert: {
      findUnique: vi.fn().mockResolvedValue({
        title: 'BCRA Test Alert',
        sourceUrl: 'https://bcra.gob.ar/test',
        jurisdiction: 'AR',
        scanLog: null,
      }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ name: 'Jane Doe', email: 'jane@acme.com' }),
    },
    organization: {
      findUnique: vi.fn().mockResolvedValue({ name: 'Acme Corp' }),
    },
  } as unknown as PrismaClient;
}

function makeRepo(): NotificationsRepo {
  return {
    findAllActiveChannels: vi.fn().mockResolvedValue([
      {
        id: 'chan-email-1',
        webhookUrl: 'compliance@acme.com',
        channelName: 'Compliance Inbox',
        provider: 'EMAIL',
        jurisdictions: [],
      },
    ]),
  } as unknown as NotificationsRepo;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EMAIL channel fan-out (integration smoke)', () => {
  let memoryEmailAdapter: MemoryEmailAdapter;
  let listener: NotificationsListenerService;

  beforeEach(() => {
    memoryEmailAdapter = makeEmailAdapter();
    const emailNotificationAdapter = makeEmailNotificationAdapter(memoryEmailAdapter);
    const registry = makeRegistry(emailNotificationAdapter);
    const prisma = makePrisma();
    const repo = makeRepo();
    const events = new EventEmitter2();

    listener = new (NotificationsListenerService as unknown as new (
      p: PrismaClient,
      r: NotificationAdapterRegistry,
      repo: NotificationsRepo,
      ev: EventEmitter2,
    ) => NotificationsListenerService)(prisma, registry, repo, events);
  });

  it('EMAIL_TRANSPORT=memory: AlertConcludedEvent → MemoryEmailAdapter inbox has 1 email with correct subject', async () => {
    await listener.onAlertConcluded({
      alertId: 'alert-1',
      organizationId: 'org-1',
      actorId: 'actor-1',
      fromStatus: 'ANALYZING',
      note: null,
      concludedAt: new Date().toISOString(),
    });

    const sent = memoryEmailAdapter.getSent();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('compliance@acme.com');
    expect(sent[0]!.subject).toBe('Alert concluded: BCRA Test Alert');
  });
});
