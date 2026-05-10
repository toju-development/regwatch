/**
 * Integration tests for `POST /inbound/email`.
 *
 * sdd/email-inbound Phase 4 task 4.3.
 *
 * Uses `@nestjs/testing` + node `fetch` against a real Nest HTTP server.
 * The guard is overridden to always pass — we test HTTP contract, not ECDSA.
 *
 * Cases:
 *   - POST /inbound/email returns 200 { ok: true } on success
 *   - POST /inbound/email returns 200 { ok: true } even when service throws
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CanActivate } from '@nestjs/common';
import { EmailInboundController } from '../email-inbound.controller.js';
import { EmailInboundService } from '../email-inbound.service.js';
import { SendGridWebhookGuard } from '../guards/sendgrid-webhook.guard.js';
import { EMAIL_INBOUND_PRISMA_TOKEN, EMAIL_INBOUND_ENV_TOKEN } from '../tokens.js';

/** Passthrough guard — always returns true */
class AlwaysPassGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

/** Minimal env mock */
const mockEnv = {
  EMAIL_INBOUND_ENABLED: true,
  SCANNER_INTERNAL_URL: 'http://localhost:9999',
  SCANNER_INTERNAL_SECRET: 'test-secret',
  EMAIL_INBOUND_WEBHOOK_SECRET: undefined,
};

/** Minimal Prisma mock */
const mockPrisma = {
  organization: {
    findUnique: vi.fn().mockResolvedValue({ id: 'org-test' }),
  },
  alert: {
    upsert: vi.fn().mockResolvedValue({ id: 'alert-test' }),
  },
};

describe('POST /inbound/email (HTTP integration)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    // Do NOT stub globalThis.fetch — the test itself uses fetch to call the server.
    // fireTrigger's scanner call will fail (localhost:9999 unreachable) but it's
    // fire-and-forget so errors are swallowed silently.

    const moduleRef = await Test.createTestingModule({
      controllers: [EmailInboundController],
      providers: [
        EmailInboundService,
        {
          provide: EMAIL_INBOUND_PRISMA_TOKEN,
          useValue: mockPrisma,
        },
        {
          provide: EMAIL_INBOUND_ENV_TOKEN,
          useValue: mockEnv,
        },
        {
          provide: SendGridWebhookGuard,
          useClass: AlwaysPassGuard,
        },
      ],
    })
      .overrideGuard(SendGridWebhookGuard)
      .useClass(AlwaysPassGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    const server = await app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No listen address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 { ok: true } on valid payload', async () => {
    const res = await fetch(`${baseUrl}/inbound/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        to: 'acme@inbound.regwatch.io',
        from: 'sender@example.com',
        subject: 'Test',
        text: 'body',
        html: '<p>body</p>',
        headers: 'Message-ID: <test@example.com>',
        envelope: JSON.stringify({ to: ['acme@inbound.regwatch.io'], from: 'sender@example.com' }),
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns 200 { ok: true } even when service throws', async () => {
    mockPrisma.organization.findUnique.mockRejectedValueOnce(new Error('DB error'));

    const res = await fetch(`${baseUrl}/inbound/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        to: 'acme@inbound.regwatch.io',
        from: 'sender@example.com',
        subject: 'Test',
        text: 'body',
        html: '',
        headers: 'Message-ID: <test2@example.com>',
        envelope: JSON.stringify({ to: ['acme@inbound.regwatch.io'], from: 'sender@example.com' }),
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
