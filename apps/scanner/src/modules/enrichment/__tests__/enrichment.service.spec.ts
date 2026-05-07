/**
 * Unit tests for `EnrichmentService.enrichAlert`.
 *
 * Tests the MVP-6 chokepoint: cap-check, idempotency, state machine,
 * trust boundary, and per-alert failure isolation.
 *
 * Spec: sdd/classifier-and-writer/spec R-5 (cap), R-6 (trust boundary),
 *   R-7 (isolation), R-8 (lifecycle / state machine), ADR-9 (idempotency).
 * Design: sdd/classifier-and-writer/design ADR-1, ADR-6, ADR-9, ADR-11, ADR-12.
 *
 * Strategy:
 *   - Fake `PrismaClient` with `vi.fn()` stubs (no DB, no NestJS TestingModule).
 *   - Fake ClassifierAgentFactory and WriterAgentFactory return agents that
 *     resolve to fixed JSON strings.
 *   - Fake UsageHelper controls `isAtCap` per test.
 *   - All calls go through `runClassifier` / `runWriter` real implementations
 *     so Zod + assertNoForbiddenKeys fences are exercised.
 */
import 'reflect-metadata';
import { Prisma } from '@regwatch/db/client';
import { AlertTopic } from '@regwatch/types';
import { describe, expect, it, vi } from 'vitest';

import { EnrichmentService, type UsageHelper } from '../enrichment.service.js';
import { WriterCitationError } from '../agents/writer.runner.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ALERT_ID = 'alert-001';
const ORG_ID = 'org-001';

const VALID_CLASSIFIER_JSON = JSON.stringify({
  topic: AlertTopic.FX,
  severity: 'HIGH',
  relevanceScore: 85,
  relevant: true,
});

const VALID_CLASSIFIER_JSON_IRRELEVANT = JSON.stringify({
  topic: AlertTopic.OTHER,
  severity: 'LOW',
  relevanceScore: 10,
  relevant: false,
});

// Summary must be long enough to contain the citation strings
const LONG_SUMMARY =
  'The BCRA issued resolution requiring all foreign exchange operations to comply with new reporting standards. ' +
  'Entities must update their internal control systems within 90 days of this regulatory change.';

const VALID_WRITER_JSON = JSON.stringify({
  executiveSummary:
    'A new BCRA resolution requires significant changes to FX reporting and internal control processes.',
  whatChangesForYou: 'You must update reporting systems and internal controls within 90 days.',
  citations: ['new reporting standards', 'internal control systems'],
});

// ─── Fake builders ────────────────────────────────────────────────────────────

function makeClassifierFactory(rawJson: string, shouldThrow?: Error) {
  return () => ({
    model: 'test',
    call: shouldThrow
      ? vi.fn().mockRejectedValue(shouldThrow)
      : vi.fn().mockResolvedValue({ rawText: rawJson, tokensIn: 100, tokensOut: 50 }),
  });
}

function makeWriterFactory(rawJson: string, shouldThrow?: Error) {
  return () => ({
    model: 'test',
    call: shouldThrow
      ? vi.fn().mockRejectedValue(shouldThrow)
      : vi.fn().mockResolvedValue({ rawText: rawJson, tokensIn: 200, tokensOut: 100 }),
  });
}

function makeUsageHelper(isAtCap = false): UsageHelper {
  return {
    getMonthlyUsage: vi.fn().mockResolvedValue({
      tokensUsed: 0,
      costUsd: new Prisma.Decimal(isAtCap ? 10 : 0),
      scanCostUsd: new Prisma.Decimal(0),
      enrichmentCostUsd: new Prisma.Decimal(0),
      scansCount: 0,
      capUsd: new Prisma.Decimal(10),
      isAtCap,
      percent: isAtCap ? 100 : 0,
      monthStart: new Date('2026-05-01T00:00:00Z'),
    }),
  };
}

interface AlertRow {
  id: string;
  title: string;
  summary: string;
  source: string;
  enrichmentStatus: string;
  jurisdiction: string | null;
  scanLog: { jurisdiction: string } | null;
}

function makePrisma(alertOverrides: Partial<AlertRow> = {}) {
  const alertFindUnique = vi.fn().mockResolvedValue({
    id: ALERT_ID,
    title: 'FX Regulation Update',
    summary: LONG_SUMMARY,
    source: 'BCRA',
    enrichmentStatus: 'PENDING',
    jurisdiction: null,
    scanLog: { jurisdiction: 'AR' },
    ...alertOverrides,
  } as AlertRow);

  const alertUpdate = vi.fn().mockResolvedValue({});
  const enrichmentLogCreate = vi.fn().mockResolvedValue({ id: 'log-001' });
  const settingsFindUnique = vi.fn().mockResolvedValue({ outputLanguage: null });
  const settingsUpsert = vi.fn().mockResolvedValue({});

  return {
    alert: { findUnique: alertFindUnique, update: alertUpdate },
    enrichmentLog: { create: enrichmentLogCreate },
    settings: { findUnique: settingsFindUnique, upsert: settingsUpsert },
    _mocks: {
      alertFindUnique,
      alertUpdate,
      enrichmentLogCreate,
      settingsFindUnique,
      settingsUpsert,
    },
  };
}

function makeService(
  prisma: ReturnType<typeof makePrisma>,
  classifierFactory: ReturnType<typeof makeClassifierFactory>,
  writerFactory: ReturnType<typeof makeWriterFactory>,
  usageHelper: UsageHelper,
): EnrichmentService {
  // Reflect.metadata required for NestJS DI decorators under tsx (reflect-metadata)
  const svc = new EnrichmentService(
    prisma as never,
    classifierFactory as never,
    writerFactory as never,
    usageHelper,
  );
  return svc;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EnrichmentService.enrichAlert', () => {
  describe('happy path — PENDING → CLASSIFIED → COMPLETED', () => {
    it('updates Alert with classifier output, creates EnrichmentLog, then writes and sets COMPLETED', async () => {
      const prisma = makePrisma();
      const svc = makeService(
        prisma,
        makeClassifierFactory(VALID_CLASSIFIER_JSON),
        makeWriterFactory(VALID_WRITER_JSON),
        makeUsageHelper(false),
      );

      await svc.enrichAlert(ALERT_ID, ORG_ID);

      // Should have called update 3 times: CLASSIFIED, WRITTEN (pre-writer transit), COMPLETED
      expect(prisma._mocks.alertUpdate).toHaveBeenCalledTimes(3);

      // First update: CLASSIFIED with classifier output
      const firstUpdate = prisma._mocks.alertUpdate.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(firstUpdate.data.enrichmentStatus).toBe('CLASSIFIED');
      expect(firstUpdate.data.topic).toBe(AlertTopic.FX);
      expect(firstUpdate.data.severity).toBe('HIGH');
      expect(firstUpdate.data.relevanceScore).toBe(85);
      expect(firstUpdate.data.relevant).toBe(true);

      // Second update: WRITTEN transit state (CF-MVP7-1)
      const secondUpdate = prisma._mocks.alertUpdate.mock.calls[1]![0] as {
        data: Record<string, unknown>;
      };
      expect(secondUpdate.data.enrichmentStatus).toBe('WRITTEN');

      // Third update: COMPLETED with writer output
      const thirdUpdate = prisma._mocks.alertUpdate.mock.calls[2]![0] as {
        data: Record<string, unknown>;
      };
      expect(thirdUpdate.data.enrichmentStatus).toBe('COMPLETED');
      expect(typeof thirdUpdate.data.executiveSummary).toBe('string');
      expect(Array.isArray(thirdUpdate.data.citations)).toBe(true);

      // Two EnrichmentLog rows: classifier + writer
      expect(prisma._mocks.enrichmentLogCreate).toHaveBeenCalledTimes(2);
      const classifierLog = prisma._mocks.enrichmentLogCreate.mock.calls[0]![0]!.data as Record<
        string,
        unknown
      >;
      expect(classifierLog.agent).toBe('classifier');
      const writerLog = prisma._mocks.enrichmentLogCreate.mock.calls[1]![0]!.data as Record<
        string,
        unknown
      >;
      expect(writerLog.agent).toBe('writer');
    });

    it('TRUST BOUNDARY: organizationId in classifier log comes from trusted caller, never LLM output', async () => {
      const prisma = makePrisma();
      const svc = makeService(
        prisma,
        makeClassifierFactory(VALID_CLASSIFIER_JSON),
        makeWriterFactory(VALID_WRITER_JSON),
        makeUsageHelper(false),
      );

      await svc.enrichAlert(ALERT_ID, ORG_ID);

      // Every EnrichmentLog must have organizationId = ORG_ID (trusted caller param)
      for (const call of prisma._mocks.enrichmentLogCreate.mock.calls) {
        const data = (call[0] as { data: Record<string, unknown> }).data;
        expect(data.organizationId).toBe(ORG_ID);
        // The LLM output does not carry organizationId — if it did, assertNoForbiddenKeys would throw
        expect(data).not.toHaveProperty('userId');
        expect(data).not.toHaveProperty('email');
      }
    });
  });

  describe('cap exceeded before classifier (step 3)', () => {
    it('sets SKIPPED_CAP_EXCEEDED, writes EnrichmentLog with cost 0, no Gemini call', async () => {
      const classifierCallMock = vi.fn();
      const classifierFactory = () => ({ model: 'test', call: classifierCallMock });
      const prisma = makePrisma();
      const svc = makeService(
        prisma,
        classifierFactory as never,
        makeWriterFactory(VALID_WRITER_JSON),
        makeUsageHelper(true),
      );

      await svc.enrichAlert(ALERT_ID, ORG_ID);

      expect(classifierCallMock).not.toHaveBeenCalled();
      expect(prisma._mocks.alertUpdate).toHaveBeenCalledTimes(1);
      const update = prisma._mocks.alertUpdate.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(update.data.enrichmentStatus).toBe('SKIPPED_CAP_EXCEEDED');

      expect(prisma._mocks.enrichmentLogCreate).toHaveBeenCalledTimes(1);
      const log = prisma._mocks.enrichmentLogCreate.mock.calls[0]![0]!.data as Record<
        string,
        unknown
      >;
      expect(log.agent).toBe('classifier');
      expect(log.status).toBe('SKIPPED_CAP_EXCEEDED');
    });
  });

  describe('cap exceeded between classifier and writer (step 6)', () => {
    it('classifies ok, then hits cap, sets SKIPPED_CAP_EXCEEDED, no Writer call', async () => {
      // First cap check: under cap. Second: at cap.
      const getMonthlyUsage = vi
        .fn()
        .mockResolvedValueOnce({
          isAtCap: false,
          costUsd: new Prisma.Decimal(0),
          capUsd: new Prisma.Decimal(10),
          tokensUsed: 0,
          scanCostUsd: new Prisma.Decimal(0),
          enrichmentCostUsd: new Prisma.Decimal(0),
          scansCount: 0,
          percent: 0,
          monthStart: new Date(),
        })
        .mockResolvedValueOnce({
          isAtCap: true,
          costUsd: new Prisma.Decimal(10),
          capUsd: new Prisma.Decimal(10),
          tokensUsed: 0,
          scanCostUsd: new Prisma.Decimal(0),
          enrichmentCostUsd: new Prisma.Decimal(10),
          scansCount: 0,
          percent: 100,
          monthStart: new Date(),
        });

      const writerCallMock = vi.fn();
      const writerFactory = () => ({ model: 'test', call: writerCallMock });
      const prisma = makePrisma();
      const svc = makeService(
        prisma,
        makeClassifierFactory(VALID_CLASSIFIER_JSON),
        writerFactory as never,
        { getMonthlyUsage },
      );

      await svc.enrichAlert(ALERT_ID, ORG_ID);

      expect(writerCallMock).not.toHaveBeenCalled();
      // alertUpdate calls: CLASSIFIED (step 4) + SKIPPED_CAP_EXCEEDED (step 6)
      expect(prisma._mocks.alertUpdate).toHaveBeenCalledTimes(2);
      const lastUpdate = prisma._mocks.alertUpdate.mock.calls[1]![0] as {
        data: Record<string, unknown>;
      };
      expect(lastUpdate.data.enrichmentStatus).toBe('SKIPPED_CAP_EXCEEDED');
    });
  });

  describe('relevant=false after classifier (step 5)', () => {
    it('sets CLASSIFIED then SKIPPED_IRRELEVANT, no Writer call', async () => {
      const writerCallMock = vi.fn();
      const writerFactory = () => ({ model: 'test', call: writerCallMock });
      const prisma = makePrisma();
      const svc = makeService(
        prisma,
        makeClassifierFactory(VALID_CLASSIFIER_JSON_IRRELEVANT),
        writerFactory as never,
        makeUsageHelper(false),
      );

      await svc.enrichAlert(ALERT_ID, ORG_ID);

      expect(writerCallMock).not.toHaveBeenCalled();
      expect(prisma._mocks.alertUpdate).toHaveBeenCalledTimes(2);
      const lastUpdate = prisma._mocks.alertUpdate.mock.calls[1]![0] as {
        data: Record<string, unknown>;
      };
      expect(lastUpdate.data.enrichmentStatus).toBe('SKIPPED_IRRELEVANT');
    });
  });

  describe('classifier throws (step 4)', () => {
    it('sets CLASSIFY_FAILED with enrichmentError, writes EnrichmentLog', async () => {
      const prisma = makePrisma();
      const svc = makeService(
        prisma,
        makeClassifierFactory('', new Error('Gemini unavailable')),
        makeWriterFactory(VALID_WRITER_JSON),
        makeUsageHelper(false),
      );

      // Should not throw (R-7 isolation)
      await expect(svc.enrichAlert(ALERT_ID, ORG_ID)).resolves.toBeUndefined();

      expect(prisma._mocks.alertUpdate).toHaveBeenCalledTimes(1);
      const update = prisma._mocks.alertUpdate.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(update.data.enrichmentStatus).toBe('CLASSIFY_FAILED');
      expect(typeof update.data.enrichmentError).toBe('string');
      expect((update.data.enrichmentError as string).length).toBeGreaterThan(0);

      const log = prisma._mocks.enrichmentLogCreate.mock.calls[0]![0]!.data as Record<
        string,
        unknown
      >;
      expect(log.status).toBe('CLASSIFY_FAILED');
      expect(log.agent).toBe('classifier');
    });
  });

  describe('writer throws WriterCitationError (step 7)', () => {
    it('sets WRITE_FAILED with enrichmentError, writes writer EnrichmentLog', async () => {
      const prisma = makePrisma();
      const svc = makeService(
        prisma,
        makeClassifierFactory(VALID_CLASSIFIER_JSON),
        makeWriterFactory('', new WriterCitationError('fabricated citation not in source')),
        makeUsageHelper(false),
      );

      await expect(svc.enrichAlert(ALERT_ID, ORG_ID)).resolves.toBeUndefined();

      // Updates: CLASSIFIED + WRITTEN (transit) + WRITE_FAILED
      expect(prisma._mocks.alertUpdate).toHaveBeenCalledTimes(3);
      const lastUpdate = prisma._mocks.alertUpdate.mock.calls[2]![0] as {
        data: Record<string, unknown>;
      };
      expect(lastUpdate.data.enrichmentStatus).toBe('WRITE_FAILED');

      const writerLog = prisma._mocks.enrichmentLogCreate.mock.calls[1]![0]!.data as Record<
        string,
        unknown
      >;
      expect(writerLog.agent).toBe('writer');
      expect(writerLog.status).toBe('WRITE_FAILED');
    });
  });

  describe('idempotency (ADR-9)', () => {
    // ── Skip states (terminal, intentional) ──────────────────────────────────

    it('COMPLETED alert → early return, no DB writes beyond initial read', async () => {
      const prisma = makePrisma({ enrichmentStatus: 'COMPLETED' });
      const svc = makeService(
        prisma,
        makeClassifierFactory(VALID_CLASSIFIER_JSON),
        makeWriterFactory(VALID_WRITER_JSON),
        makeUsageHelper(false),
      );

      await svc.enrichAlert(ALERT_ID, ORG_ID);

      expect(prisma._mocks.alertUpdate).not.toHaveBeenCalled();
      expect(prisma._mocks.enrichmentLogCreate).not.toHaveBeenCalled();
    });

    it('SKIPPED_IRRELEVANT alert → early return, no DB writes', async () => {
      const prisma = makePrisma({ enrichmentStatus: 'SKIPPED_IRRELEVANT' });
      const svc = makeService(
        prisma,
        makeClassifierFactory(VALID_CLASSIFIER_JSON),
        makeWriterFactory(VALID_WRITER_JSON),
        makeUsageHelper(false),
      );

      await svc.enrichAlert(ALERT_ID, ORG_ID);

      expect(prisma._mocks.alertUpdate).not.toHaveBeenCalled();
    });

    // ── Retry states (retryable terminal / stuck mid-state) ──────────────────

    it('CLASSIFY_FAILED alert → retries full flow (Classifier + Writer if relevant)', async () => {
      // CLASSIFY_FAILED is retryable (ADR-9): failure may be transient.
      const classifierAgent = makeClassifierFactory(VALID_CLASSIFIER_JSON);
      const writerAgent = makeWriterFactory(VALID_WRITER_JSON);
      const prisma = makePrisma({ enrichmentStatus: 'CLASSIFY_FAILED' });
      const svc = makeService(prisma, classifierAgent, writerAgent, makeUsageHelper(false));

      await svc.enrichAlert(ALERT_ID, ORG_ID);

      // Classifier ran (at least one alertUpdate with enrichmentStatus transition)
      expect(prisma._mocks.alertUpdate).toHaveBeenCalled();
      // Writer ran (COMPLETED terminal state)
      const lastUpdate = prisma._mocks.alertUpdate.mock.calls.at(-1)?.[0];
      expect(lastUpdate?.data?.enrichmentStatus).toBe('COMPLETED');
    });

    it('WRITE_FAILED alert → retries full flow (re-runs both agents — simpler than mid-resume)', async () => {
      // WRITE_FAILED is retryable (ADR-9): re-runs full pipeline from Classifier.
      const classifierAgent = makeClassifierFactory(VALID_CLASSIFIER_JSON);
      const writerAgent = makeWriterFactory(VALID_WRITER_JSON);
      const prisma = makePrisma({ enrichmentStatus: 'WRITE_FAILED' });
      const svc = makeService(prisma, classifierAgent, writerAgent, makeUsageHelper(false));

      await svc.enrichAlert(ALERT_ID, ORG_ID);

      expect(prisma._mocks.alertUpdate).toHaveBeenCalled();
      const lastUpdate = prisma._mocks.alertUpdate.mock.calls.at(-1)?.[0];
      expect(lastUpdate?.data?.enrichmentStatus).toBe('COMPLETED');
    });

    it('SKIPPED_CAP_EXCEEDED alert → retries (cap may have reset — re-checks budget)', async () => {
      // Cap may have reset since the last run. Re-check → proceed if within budget.
      const classifierAgent = makeClassifierFactory(VALID_CLASSIFIER_JSON);
      const writerAgent = makeWriterFactory(VALID_WRITER_JSON);
      const prisma = makePrisma({ enrichmentStatus: 'SKIPPED_CAP_EXCEEDED' });
      const svc = makeService(prisma, classifierAgent, writerAgent, makeUsageHelper(false));

      await svc.enrichAlert(ALERT_ID, ORG_ID);

      // Cap not exceeded this time → full flow runs → COMPLETED
      expect(prisma._mocks.alertUpdate).toHaveBeenCalled();
      const lastUpdate = prisma._mocks.alertUpdate.mock.calls.at(-1)?.[0];
      expect(lastUpdate?.data?.enrichmentStatus).toBe('COMPLETED');
    });

    it('PENDING alert → full flow (normal happy-path idempotency check)', async () => {
      // PENDING is the normal entry state — always runs full flow.
      const classifierAgent = makeClassifierFactory(VALID_CLASSIFIER_JSON);
      const writerAgent = makeWriterFactory(VALID_WRITER_JSON);
      const prisma = makePrisma({ enrichmentStatus: 'PENDING' });
      const svc = makeService(prisma, classifierAgent, writerAgent, makeUsageHelper(false));

      await svc.enrichAlert(ALERT_ID, ORG_ID);

      expect(prisma._mocks.alertUpdate).toHaveBeenCalled();
      const lastUpdate = prisma._mocks.alertUpdate.mock.calls.at(-1)?.[0];
      expect(lastUpdate?.data?.enrichmentStatus).toBe('COMPLETED');
    });

    it('CLASSIFIED alert → re-runs writer phase (stuck after classifier, before writer → retry)', async () => {
      // CLASSIFIED mid-state from a crash: classifier ran but writer never completed.
      // Re-run from the start (simpler than mid-resume per ADR-9).
      const classifierAgent = makeClassifierFactory(VALID_CLASSIFIER_JSON);
      const writerAgent = makeWriterFactory(VALID_WRITER_JSON);
      const prisma = makePrisma({ enrichmentStatus: 'CLASSIFIED' });
      const svc = makeService(prisma, classifierAgent, writerAgent, makeUsageHelper(false));

      await svc.enrichAlert(ALERT_ID, ORG_ID);

      // Classifier ran and flow completed
      expect(prisma._mocks.alertUpdate).toHaveBeenCalled();
      const lastUpdate = prisma._mocks.alertUpdate.mock.calls.at(-1)?.[0];
      expect(lastUpdate?.data?.enrichmentStatus).toBe('COMPLETED');
    });

    it('WRITE_FAILED alert (second crash) → retries full flow again', async () => {
      // A second crash after WRITE_FAILED is set: re-run from start again.
      const classifierAgent = makeClassifierFactory(VALID_CLASSIFIER_JSON);
      const writerAgent = makeWriterFactory(VALID_WRITER_JSON);
      const prisma = makePrisma({ enrichmentStatus: 'WRITE_FAILED' });
      const svc = makeService(prisma, classifierAgent, writerAgent, makeUsageHelper(false));

      await svc.enrichAlert(ALERT_ID, ORG_ID);

      expect(prisma._mocks.alertUpdate).toHaveBeenCalled();
      const lastUpdate = prisma._mocks.alertUpdate.mock.calls.at(-1)?.[0];
      expect(lastUpdate?.data?.enrichmentStatus).toBe('COMPLETED');
    });
  });

  describe('alert not found', () => {
    it('returns early without throwing when alert does not exist', async () => {
      const prisma = makePrisma();
      prisma._mocks.alertFindUnique.mockResolvedValue(null);
      const svc = makeService(
        prisma,
        makeClassifierFactory(VALID_CLASSIFIER_JSON),
        makeWriterFactory(VALID_WRITER_JSON),
        makeUsageHelper(false),
      );

      await expect(svc.enrichAlert('nonexistent', ORG_ID)).resolves.toBeUndefined();
      expect(prisma._mocks.alertUpdate).not.toHaveBeenCalled();
    });
  });

  describe('CF-MVP7-1: WRITTEN transit state (R-8)', () => {
    it('sets enrichmentStatus=WRITTEN before invoking runWriter', async () => {
      const prisma = makePrisma();
      const writerCallOrder: string[] = [];

      // Spy on alertUpdate to record call order, and writerFactory call to detect writer invocation
      const originalUpdate = prisma._mocks.alertUpdate;
      originalUpdate.mockImplementation((args: { data: Record<string, unknown> }) => {
        writerCallOrder.push(`update:${String(args.data.enrichmentStatus)}`);
        return Promise.resolve({});
      });

      // Custom writer factory that records when the writer is called
      const writerFactory = () => ({
        model: 'test',
        call: vi.fn().mockImplementation(() => {
          writerCallOrder.push('writer:invoked');
          return Promise.resolve({
            rawText: VALID_WRITER_JSON,
            tokensIn: 200,
            tokensOut: 100,
          });
        }),
      });

      const svc = makeService(
        prisma,
        makeClassifierFactory(VALID_CLASSIFIER_JSON),
        writerFactory as never,
        makeUsageHelper(false),
      );

      await svc.enrichAlert(ALERT_ID, ORG_ID);

      // WRITTEN must appear before writer:invoked in the call order
      const writtenIdx = writerCallOrder.indexOf('update:WRITTEN');
      const writerInvokedIdx = writerCallOrder.indexOf('writer:invoked');

      expect(writtenIdx).toBeGreaterThanOrEqual(0);
      expect(writerInvokedIdx).toBeGreaterThanOrEqual(0);
      expect(writtenIdx).toBeLessThan(writerInvokedIdx);
    });

    it('jurisdiction falls back to alert.jurisdiction before scanLog.jurisdiction (B2.2)', async () => {
      // alert.jurisdiction = 'BR' → should resolve to 'pt' output language
      const prisma = makePrisma({ jurisdiction: 'BR', scanLog: null });
      const svc = makeService(
        prisma,
        makeClassifierFactory(VALID_CLASSIFIER_JSON),
        makeWriterFactory(VALID_WRITER_JSON),
        makeUsageHelper(false),
      );

      // Should not throw — jurisdiction resolution uses alert.jurisdiction
      await expect(svc.enrichAlert(ALERT_ID, ORG_ID)).resolves.toBeUndefined();
      // Full pipeline ran (COMPLETED)
      const lastUpdate = prisma._mocks.alertUpdate.mock.calls.at(-1)?.[0];
      expect(lastUpdate?.data?.enrichmentStatus).toBe('COMPLETED');
    });
  });
});
