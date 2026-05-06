/**
 * Integration tests for the MVP-6 Enrichment pipeline.
 *
 * Strategy:
 *   - NestJS `Test.createTestingModule` with real PrismaModule + real DB (DATABASE_URL).
 *   - `CLASSIFIER_AGENT_FACTORY` and `WRITER_AGENT_FACTORY` overridden with
 *     controllable mock factories — Gemini HTTP is NEVER called.
 *   - `ENRICHMENT_GEMINI_CLIENT` overridden with a stub to bypass GOOGLE_API_KEY check.
 *   - Seed real Org + ScanLog + Alert rows before each scenario.
 *   - Call `listener.handleScanCompleted(payload)` directly and `await` it —
 *     avoids EventEmitter2 fire-and-forget race.
 *   - Clean up seeded rows after each test (cascade via Organization delete).
 *
 * Scenarios:
 *   B8.1 — Happy path: COMPLETED, topic/score/executiveSummary/whatChangesForYou set.
 *   B8.2 — Cap exceeded: SKIPPED_CAP_EXCEEDED, zero Gemini calls, lastSkippedCapAt set.
 *   B8.3 — Irrelevant skip: SKIPPED_IRRELEVANT, Writer never called.
 *
 * Spec: sdd/classifier-and-writer/spec R-1, R-2, R-5, R-9.
 * Design: sdd/classifier-and-writer/design ADR-1, ADR-6, ADR-9.
 */
import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaClient } from '@regwatch/db/client';
import { AlertTopic } from '@regwatch/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

function uid(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
}

import { PRISMA_CLIENT } from '../../../common/prisma/prisma.token.js';
import { CLASSIFIER_AGENT_FACTORY, WRITER_AGENT_FACTORY } from '../tokens.js';
import { EnrichmentModule } from '../enrichment.module.js';
import { EnrichmentListener } from '../enrichment.listener.js';
import type { ScanCompletedEvent } from '@regwatch/types/events';

// ─── DB client (real Postgres) ────────────────────────────────────────────────

const realPrisma = new PrismaClient();

// ─── Fake PrismaModule (global) ───────────────────────────────────────────────

/**
 * Provides the SAME `realPrisma` instance via the PRISMA_CLIENT token.
 * @Global() mirrors PrismaModule so EnrichmentModule can inject it.
 */
@Global()
@Module({
  providers: [{ provide: PRISMA_CLIENT, useValue: realPrisma }],
  exports: [PRISMA_CLIENT],
})
class TestPrismaModule {}

// ─── Internal symbol (must match enrichment.module.ts) ───────────────────────

const ENRICHMENT_GEMINI_CLIENT = Symbol.for('regwatch.enrichment.GEMINI_CLIENT');

// ─── Mock factory builders ────────────────────────────────────────────────────

const SEEDED_SUMMARY =
  'The BCRA issued a resolution requiring all foreign exchange operations to comply with ' +
  'new reporting standards effective immediately. ' +
  'Financial entities must update their internal control systems within 90 days.';

/** Valid ClassifierOutput JSON for the happy-path / cap-exceeded seeded summary. */
const VALID_CLASSIFIER_JSON = JSON.stringify({
  topic: AlertTopic.FX,
  severity: 'HIGH',
  relevanceScore: 80,
  relevant: true,
});

/** ClassifierOutput JSON marking alert as irrelevant (B8.3). */
const IRRELEVANT_CLASSIFIER_JSON = JSON.stringify({
  topic: AlertTopic.OTHER,
  severity: 'LOW',
  relevanceScore: 5,
  relevant: false,
});

/**
 * Valid WriterOutput JSON. Citations MUST be substrings of SEEDED_SUMMARY
 * (normalized: lowercase + collapsed whitespace — ADR-5).
 */
const VALID_WRITER_JSON = JSON.stringify({
  executiveSummary:
    'A new BCRA resolution mandates immediate compliance changes for FX operations, ' +
    'requiring all entities to update their reporting and control systems.',
  whatChangesForYou: 'Update internal control systems and reporting infrastructure within 90 days.',
  citations: [
    'new reporting standards effective immediately',
    'internal control systems within 90 days',
  ],
});

function makeClassifierFactory(rawJson: string) {
  const callSpy = vi.fn().mockResolvedValue({
    rawText: rawJson,
    tokensIn: 100,
    tokensOut: 50,
  });
  const factory = () => ({ model: 'test', call: callSpy });
  return { factory, callSpy };
}

function makeWriterFactory(rawJson: string) {
  const callSpy = vi.fn().mockResolvedValue({
    rawText: rawJson,
    tokensIn: 200,
    tokensOut: 100,
  });
  const factory = () => ({ model: 'test', call: callSpy });
  return { factory, callSpy };
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

async function seedOrg(slug: string) {
  return realPrisma.organization.create({
    data: {
      id: uid(),
      slug,
      name: `Test Org ${slug}`,
    },
  });
}

async function seedSettings(orgId: string, overrides: Record<string, unknown> = {}) {
  return realPrisma.settings.create({
    data: {
      organizationId: orgId,
      jurisdictions: ['AR'],
      ...overrides,
    },
  });
}

async function seedScanLog(orgId: string, costUsd = '0') {
  return realPrisma.scanLog.create({
    data: {
      organizationId: orgId,
      jurisdiction: 'AR',
      status: 'COMPLETED',
      costUsd,
      alertsFound: 1,
    },
  });
}

async function seedAlert(orgId: string, scanLogId: string) {
  const slug = uid();
  return realPrisma.alert.create({
    data: {
      organizationId: orgId,
      scanLogId,
      source: 'BCRA_COMUNICADOS_A',
      sourceUrl: `https://bcra.gob.ar/test/${slug}`,
      sourceUrlHash: slug.padEnd(64, '0').slice(0, 64),
      title: 'Test regulatory alert for enrichment integration',
      summary: SEEDED_SUMMARY,
      enrichmentStatus: 'PENDING',
    },
  });
}

// ─── Module builder ───────────────────────────────────────────────────────────

async function buildModule(
  classifierFactory: ReturnType<typeof makeClassifierFactory>['factory'],
  writerFactory: ReturnType<typeof makeWriterFactory>['factory'],
): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [TestPrismaModule, EventEmitterModule.forRoot(), EnrichmentModule],
  })
    .overrideProvider(ENRICHMENT_GEMINI_CLIENT)
    .useValue({ stub: 'no-gemini' })
    .overrideProvider(CLASSIFIER_AGENT_FACTORY)
    .useValue(classifierFactory)
    .overrideProvider(WRITER_AGENT_FACTORY)
    .useValue(writerFactory)
    .compile();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Enrichment integration tests — B8 (real Postgres, mocked Gemini)', () => {
  // Track org IDs to clean up after each test.
  let orgIdsToCleanup: string[] = [];

  afterEach(async () => {
    if (orgIdsToCleanup.length > 0) {
      await realPrisma.organization.deleteMany({
        where: { id: { in: orgIdsToCleanup } },
      });
      orgIdsToCleanup = [];
    }
  });

  // ── B8.1 — Happy path ──────────────────────────────────────────────────────

  it('B8.1 — happy path: Alert reaches COMPLETED with all enrichment fields set', async () => {
    // ── Arrange ────────────────────────────────────────────────────────────
    const classifier = makeClassifierFactory(VALID_CLASSIFIER_JSON);
    const writer = makeWriterFactory(VALID_WRITER_JSON);
    const moduleRef = await buildModule(classifier.factory, writer.factory);

    const org = await seedOrg(`b81-${uid()}`);
    orgIdsToCleanup.push(org.id);
    await seedSettings(org.id); // no outputLanguage override → 'es' (AR default)
    const scanLog = await seedScanLog(org.id, '0.001');
    const alert = await seedAlert(org.id, scanLog.id);

    const listener = moduleRef.get(EnrichmentListener);
    const payload: ScanCompletedEvent = {
      scanLogId: scanLog.id,
      organizationId: org.id,
      jurisdiction: 'AR',
      status: 'COMPLETED',
      alertsFound: 1,
      tokensUsed: 500,
      costUsd: '0.001',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      errorMsg: null,
    };

    // ── Act ────────────────────────────────────────────────────────────────
    await listener.handleScanCompleted(payload);

    // ── Assert: Alert row ──────────────────────────────────────────────────
    const updatedAlert = await realPrisma.alert.findUniqueOrThrow({
      where: { id: alert.id },
    });

    expect(updatedAlert.enrichmentStatus).toBe('COMPLETED');
    expect(Object.values(AlertTopic)).toContain(updatedAlert.topic);
    expect(updatedAlert.relevanceScore).toBeGreaterThanOrEqual(0);
    expect(updatedAlert.relevanceScore).toBeLessThanOrEqual(100);
    expect(updatedAlert.relevant).toBe(true);
    expect(updatedAlert.executiveSummary).toBeTruthy();
    expect(typeof updatedAlert.executiveSummary).toBe('string');
    expect(updatedAlert.whatChangesForYou).toBeTruthy();
    expect(typeof updatedAlert.whatChangesForYou).toBe('string');
    // writtenAt is the enrichedAt equivalent in our schema
    expect(updatedAlert.writtenAt).not.toBeNull();

    // ── Assert: EnrichmentLog rows ─────────────────────────────────────────
    const logs = await realPrisma.enrichmentLog.findMany({
      where: { alertId: alert.id },
      orderBy: { createdAt: 'asc' },
    });

    expect(logs).toHaveLength(2);
    const classifierLog = logs.find((l) => l.agent === 'classifier');
    const writerLog = logs.find((l) => l.agent === 'writer');

    expect(classifierLog).toBeDefined();
    expect(Number(classifierLog!.costUsd)).toBeGreaterThan(0);
    expect(writerLog).toBeDefined();
    expect(Number(writerLog!.costUsd)).toBeGreaterThan(0);

    await moduleRef.close();
  });

  // ── B8.2 — Cap exceeded ────────────────────────────────────────────────────

  it('B8.2 — cap exceeded: Alert reaches SKIPPED_CAP_EXCEEDED, no Gemini calls made', async () => {
    // ── Arrange ────────────────────────────────────────────────────────────
    const classifier = makeClassifierFactory(VALID_CLASSIFIER_JSON);
    const writer = makeWriterFactory(VALID_WRITER_JSON);
    const moduleRef = await buildModule(classifier.factory, writer.factory);

    const org = await seedOrg(`b82-${uid()}`);
    orgIdsToCleanup.push(org.id);
    await seedSettings(org.id);

    // Seed a ScanLog with costUsd = $10.00 — exactly at the cap
    const scanLog = await seedScanLog(org.id, '10.00');
    const alert = await seedAlert(org.id, scanLog.id);

    const listener = moduleRef.get(EnrichmentListener);
    const payload: ScanCompletedEvent = {
      scanLogId: scanLog.id,
      organizationId: org.id,
      jurisdiction: 'AR',
      status: 'COMPLETED',
      alertsFound: 1,
      tokensUsed: 0,
      costUsd: '0',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      errorMsg: null,
    };

    // ── Act ────────────────────────────────────────────────────────────────
    await listener.handleScanCompleted(payload);

    // ── Assert: Alert row ──────────────────────────────────────────────────
    const updatedAlert = await realPrisma.alert.findUniqueOrThrow({
      where: { id: alert.id },
    });
    expect(updatedAlert.enrichmentStatus).toBe('SKIPPED_CAP_EXCEEDED');

    // ── Assert: zero Gemini calls ──────────────────────────────────────────
    expect(classifier.callSpy).not.toHaveBeenCalled();
    expect(writer.callSpy).not.toHaveBeenCalled();

    // ── Assert: Settings.lastSkippedCapAt is non-null and recent ──────────
    const settings = await realPrisma.settings.findUniqueOrThrow({
      where: { organizationId: org.id },
    });
    expect(settings.lastSkippedCapAt).not.toBeNull();
    const ageMs = Date.now() - settings.lastSkippedCapAt!.getTime();
    expect(ageMs).toBeLessThan(10_000); // set within the last 10 seconds

    await moduleRef.close();
  });

  // ── B8.3 — Irrelevant skip ─────────────────────────────────────────────────

  it('B8.3 — irrelevant skip: Alert reaches SKIPPED_IRRELEVANT, Writer never called', async () => {
    // ── Arrange ────────────────────────────────────────────────────────────
    const classifier = makeClassifierFactory(IRRELEVANT_CLASSIFIER_JSON);
    const writer = makeWriterFactory(VALID_WRITER_JSON);
    const moduleRef = await buildModule(classifier.factory, writer.factory);

    const org = await seedOrg(`b83-${uid()}`);
    orgIdsToCleanup.push(org.id);
    await seedSettings(org.id);
    const scanLog = await seedScanLog(org.id, '0.001');
    const alert = await seedAlert(org.id, scanLog.id);

    const listener = moduleRef.get(EnrichmentListener);
    const payload: ScanCompletedEvent = {
      scanLogId: scanLog.id,
      organizationId: org.id,
      jurisdiction: 'AR',
      status: 'COMPLETED',
      alertsFound: 1,
      tokensUsed: 500,
      costUsd: '0.001',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      errorMsg: null,
    };

    // ── Act ────────────────────────────────────────────────────────────────
    await listener.handleScanCompleted(payload);

    // ── Assert: Alert row ──────────────────────────────────────────────────
    const updatedAlert = await realPrisma.alert.findUniqueOrThrow({
      where: { id: alert.id },
    });
    expect(updatedAlert.enrichmentStatus).toBe('SKIPPED_IRRELEVANT');
    expect(updatedAlert.executiveSummary).toBeNull();

    // ── Assert: Classifier was called, Writer was NOT ──────────────────────
    expect(classifier.callSpy).toHaveBeenCalledOnce();
    expect(writer.callSpy).not.toHaveBeenCalled();

    await moduleRef.close();
  });
});
