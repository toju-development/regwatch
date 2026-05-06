/**
 * Integration tests for `EnrichmentController` — `POST /enrich/trigger`.
 *
 * Strategy:
 *   - Boot a minimal `TestingModule` with only `EnrichmentModule`.
 *   - Override all heavy providers (Gemini, Prisma, service) with stubs.
 *   - Lift app on ephemeral port; exercise the endpoint via `fetch`.
 *   - No real DB required — `EnrichmentService.enrichAlert` is mocked.
 *
 * Scenarios (B3.5):
 *   - Valid secret + alertId/organizationId → 202 `{ accepted: true, alertId }`
 *   - Invalid secret → 401
 *   - Missing body fields → 400
 *
 * Spec: sdd/manual-ingestion B3.5. Design: ADR-1, ADR-8.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Global, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { PRISMA_CLIENT } from '../../../common/prisma/prisma.token.js';
import { CLASSIFIER_AGENT_FACTORY, ENRICHMENT_SERVICE, WRITER_AGENT_FACTORY } from '../tokens.js';
import { USAGE_HELPER } from '../../scan/tokens.js';
import { EnrichmentModule } from '../enrichment.module.js';

// ─── Stubs ────────────────────────────────────────────────────────────────────

const ENRICHMENT_GEMINI_CLIENT = Symbol.for('regwatch.enrichment.GEMINI_CLIENT');

// EnrichmentSweeper calls prisma.alert.findMany on bootstrap — provide a stub.
const stubPrisma = {
  alert: { findMany: vi.fn().mockResolvedValue([]) },
};
const stubUsageHelper = { getMonthlyUsage: vi.fn() };
const stubClassifierFactory = vi.fn();
const stubWriterFactory = vi.fn();
const mockEnrichAlert = vi.fn().mockResolvedValue(undefined);
const mockEnrichmentService = { enrichAlert: mockEnrichAlert };

@Global()
@Module({
  providers: [{ provide: PRISMA_CLIENT, useValue: stubPrisma }],
  exports: [PRISMA_CLIENT],
})
class FakePrismaModule {}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('EnrichmentController — POST /enrich/trigger (HTTP integration)', () => {
  let app: INestApplication;
  let baseUrl: string;

  const SECRET = 'integration-test-secret-xyz';

  beforeAll(async () => {
    process.env['SCANNER_INTERNAL_SECRET'] = SECRET;

    const moduleRef = await Test.createTestingModule({
      imports: [FakePrismaModule, EventEmitterModule.forRoot(), EnrichmentModule],
    })
      .overrideProvider(ENRICHMENT_GEMINI_CLIENT)
      .useValue({ stub: 'gemini' })
      .overrideProvider(USAGE_HELPER)
      .useValue(stubUsageHelper)
      .overrideProvider(CLASSIFIER_AGENT_FACTORY)
      .useValue(stubClassifierFactory)
      .overrideProvider(WRITER_AGENT_FACTORY)
      .useValue(stubWriterFactory)
      .overrideProvider(ENRICHMENT_SERVICE)
      .useValue(mockEnrichmentService)
      // Also override the class token so useExisting resolves to our stub.
      .overrideProvider('EnrichmentService')
      .useValue(mockEnrichmentService)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    const server = await app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to determine listen address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    delete process.env['SCANNER_INTERNAL_SECRET'];
    await app.close();
  });

  it('202 — valid secret + body → accepted: true + alertId', async () => {
    const alertId = 'alert-abc-123';

    const res = await fetch(`${baseUrl}/enrich/trigger`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': SECRET,
      },
      body: JSON.stringify({ alertId, organizationId: 'org-001' }),
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ accepted: true, alertId });
    expect(mockEnrichAlert).toHaveBeenCalledWith(alertId, 'org-001');
  });

  it('401 — wrong secret → Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/enrich/trigger`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': 'wrong-secret',
      },
      body: JSON.stringify({ alertId: 'a', organizationId: 'o' }),
    });

    expect(res.status).toBe(401);
  });

  it('401 — missing header → Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/enrich/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alertId: 'a', organizationId: 'o' }),
    });

    expect(res.status).toBe(401);
  });

  it('400 — missing alertId → BadRequest', async () => {
    const res = await fetch(`${baseUrl}/enrich/trigger`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': SECRET,
      },
      body: JSON.stringify({ organizationId: 'org-001' }),
    });

    expect(res.status).toBe(400);
  });

  it('400 — missing organizationId → BadRequest', async () => {
    const res = await fetch(`${baseUrl}/enrich/trigger`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': SECRET,
      },
      body: JSON.stringify({ alertId: 'alert-xyz' }),
    });

    expect(res.status).toBe(400);
  });
});
