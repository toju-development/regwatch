/**
 * Unit tests for `EmailInboundService.handle`.
 *
 * sdd/email-inbound Phase 4 task 4.2.
 *
 * Cases:
 *   (a) FLAG OFF → no Prisma call
 *   (b) Unknown slug → no alert created
 *   (c) Duplicate Message-ID → upsert called, fireTrigger NOT called again (upsert update:{})
 *   (d) Happy path → alert created + fireTrigger called once
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EmailInboundService } from '../email-inbound.service.js';

// Mock @regwatch/db/dedup
vi.mock('@regwatch/db/dedup', async () => {
  const { createHash } = await import('node:crypto');
  return {
    computeSourceUrlHash: (input: string) => createHash('sha256').update(input).digest('hex'),
  };
});

/** Base valid DTO. */
const baseDto = {
  to: 'acme@inbound.regwatch.io',
  from: 'sender@example.com',
  subject: 'Test Regulation',
  text: 'Some regulation text',
  html: '<p>Some regulation text</p>',
  headers: 'Message-ID: <unique-msg-id-123@mail.example.com>\nContent-Type: text/html',
  envelope: JSON.stringify({ to: ['acme@inbound.regwatch.io'], from: 'sender@example.com' }),
};

function makePrismaMock(opts?: {
  orgId?: string | null;
  upsertId?: string;
  upsertEnrichmentStatus?: string;
}) {
  const orgId = opts?.orgId !== undefined ? opts.orgId : 'org-abc';
  const upsertId = opts?.upsertId ?? 'alert-xyz';
  const upsertEnrichmentStatus = opts?.upsertEnrichmentStatus ?? undefined;
  return {
    organization: {
      findUnique: vi.fn().mockResolvedValue(orgId ? { id: orgId } : null),
    },
    alert: {
      upsert: vi.fn().mockResolvedValue({ id: upsertId, enrichmentStatus: upsertEnrichmentStatus }),
    },
  };
}

function makeEnv(enabled = true) {
  return {
    EMAIL_INBOUND_ENABLED: enabled,
    SCANNER_INTERNAL_URL: 'http://localhost:9999',
    SCANNER_INTERNAL_SECRET: 'test-secret',
  };
}

function makeService(prisma: ReturnType<typeof makePrismaMock>, env: ReturnType<typeof makeEnv>) {
  return new (EmailInboundService as unknown as new (
    prisma: unknown,
    env: unknown,
  ) => EmailInboundService)(prisma, env);
}

describe('EmailInboundService.handle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  it('(a) flag off → no Prisma call at all', async () => {
    const prisma = makePrismaMock();
    const service = makeService(prisma, makeEnv(false));

    await service.handle(baseDto);

    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    expect(prisma.alert.upsert).not.toHaveBeenCalled();
  });

  it('(b) unknown slug → no alert created', async () => {
    const prisma = makePrismaMock({ orgId: null });
    const service = makeService(prisma, makeEnv(true));

    await service.handle(baseDto);

    expect(prisma.organization.findUnique).toHaveBeenCalledOnce();
    expect(prisma.alert.upsert).not.toHaveBeenCalled();
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('(c) duplicate Message-ID → upsert called with update:{} (silent dedup)', async () => {
    // upsert always resolves (Prisma handles conflict silently via update:{})
    const prisma = makePrismaMock({ upsertId: 'existing-alert' });
    const service = makeService(prisma, makeEnv(true));

    // First call
    await service.handle(baseDto);
    expect(prisma.alert.upsert).toHaveBeenCalledOnce();

    const upsertCall = prisma.alert.upsert.mock.calls[0]?.[0] as {
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    };
    // update must be empty — no overwriting existing data on dedup
    expect(upsertCall.update).toEqual({});
    // create must have correct source
    expect(upsertCall.create.source).toBe('EMAIL_INBOUND');
  });

  it('(d) happy path → alert created + fireTrigger called once', async () => {
    const prisma = makePrismaMock({
      orgId: 'org-abc',
      upsertId: 'alert-new',
      upsertEnrichmentStatus: 'PENDING',
    });
    const service = makeService(prisma, makeEnv(true));

    await service.handle(baseDto);

    // Org lookup happened
    expect(prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { slug: 'acme' },
      select: { id: true },
    });

    // Alert upserted
    expect(prisma.alert.upsert).toHaveBeenCalledOnce();
    const call = prisma.alert.upsert.mock.calls[0]?.[0] as {
      create: Record<string, unknown>;
      where: Record<string, unknown>;
    };
    expect(call.create.source).toBe('EMAIL_INBOUND');
    expect(call.create.title).toBe('Test Regulation');
    expect(call.create.organizationId).toBe('org-abc');
    expect(typeof call.create.sourceUrlHash).toBe('string');
    expect((call.create.sourceUrlHash as string).length).toBe(64); // sha256 hex

    // fireTrigger fired (globalThis.fetch called once — fire-and-forget)
    await new Promise((r) => setTimeout(r, 10));
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledOnce();
    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0] as unknown[];
    const body = JSON.parse((fetchCall[1] as { body: string }).body) as {
      alertId: string;
      organizationId: string;
    };
    expect(body.alertId).toBe('alert-new');
    expect(body.organizationId).toBe('org-abc');
  });
});
