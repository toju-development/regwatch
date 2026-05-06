/**
 * Unit tests for `IngestService`.
 *
 * sdd/manual-ingestion B4.10:
 *   - URL path: happy → creates Alert, fires trigger.
 *   - Text path: happy → creates Alert.
 *   - Dedup: P2002 → DuplicateAlertError.
 *   - Scanner trigger failure → Alert still created, WARN logged.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IngestService, DuplicateAlertError } from '../ingest.service.js';

// Mock url-fetcher so no real network calls happen.
vi.mock('../utils/url-fetcher.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../utils/url-fetcher.js')>();
  return {
    ...original,
    fetchUrl: vi.fn(),
  };
});

// Mock pdf-extractor.
vi.mock('../utils/pdf-extractor.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../utils/pdf-extractor.js')>();
  return {
    ...original,
    extractPdfText: vi.fn(),
  };
});

// Mock @regwatch/db/dedup to avoid loading @regwatch/db root (server-only).
// The factory uses only node: builtins which are always available.
vi.mock('@regwatch/db/dedup', async () => {
  const { createHash: ch } = await import('node:crypto');
  return {
    normalizeUrl: (url: string) => url,
    computeSourceUrlHash: (input: string | Buffer) => ch('sha256').update(input).digest('hex'),
  };
});

import { fetchUrl } from '../utils/url-fetcher.js';
import { extractPdfText } from '../utils/pdf-extractor.js';

const mockedFetchUrl = vi.mocked(fetchUrl);
const mockedExtractPdfText = vi.mocked(extractPdfText);

/** Build a minimal PrismaClient mock */
function makePrismaMock(overrides?: {
  alertCreate?: () => Promise<{ id: string }>;
  alertFindFirst?: () => Promise<{ id: string } | null>;
}) {
  return {
    alert: {
      create: vi.fn(overrides?.alertCreate ?? (() => Promise.resolve({ id: 'alert-123' }))),
      findFirst: vi.fn(overrides?.alertFindFirst ?? (() => Promise.resolve({ id: 'alert-123' }))),
    },
  };
}

/** Build a minimal env mock */
function makeEnvMock(
  overrides?: Partial<{
    SCANNER_INTERNAL_URL: string;
    SCANNER_INTERNAL_SECRET: string;
    MANUAL_INGEST_ENABLED: string;
  }>,
) {
  return {
    SCANNER_INTERNAL_URL: 'http://localhost:3002',
    SCANNER_INTERNAL_SECRET: 'test-secret',
    MANUAL_INGEST_ENABLED: 'true',
    ...overrides,
  };
}

function makeService(prismaMock = makePrismaMock(), envMock = makeEnvMock()): IngestService {
  // Construct without DI — pass deps directly via reflection.
  const service = new (IngestService as unknown as new (
    prisma: unknown,
    env: unknown,
  ) => IngestService)(prismaMock, envMock);
  return service;
}

describe('IngestService.ingestUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stub globalThis.fetch to avoid real network calls in fireTrigger.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  it('happy path: fetches URL, creates Alert, fires trigger', async () => {
    mockedFetchUrl.mockResolvedValueOnce({ text: 'page content', title: 'Page Title' });

    const prismaMock = makePrismaMock();
    const service = makeService(prismaMock);

    const result = await service.ingestUrl(
      { type: 'url', url: 'https://example.com/doc', jurisdiction: 'AR' },
      'org-1',
    );

    expect(result.alertId).toBe('alert-123');
    expect(prismaMock.alert.create).toHaveBeenCalledOnce();
    const createArgs = (
      prismaMock.alert.create.mock.calls as { data: Record<string, unknown> }[][]
    )[0]?.[0];
    expect(createArgs?.data.source).toBe('MANUAL');
    expect(createArgs?.data.organizationId).toBe('org-1');
    expect(createArgs?.data.jurisdiction).toBe('AR');
    expect(createArgs?.data.enrichmentStatus).toBe('PENDING');
    // Trigger was fired (globalThis.fetch called).
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledOnce();
  });

  it('dedup P2002 → throws DuplicateAlertError with existing id', async () => {
    mockedFetchUrl.mockResolvedValueOnce({ text: 'content' });

    const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    const prismaMock = makePrismaMock({
      alertCreate: () => Promise.reject(p2002),
      alertFindFirst: () => Promise.resolve({ id: 'existing-id' }),
    });
    const service = makeService(prismaMock);

    let caught: unknown;
    try {
      await service.ingestUrl(
        { type: 'url', url: 'https://example.com', jurisdiction: 'BR' },
        'org-1',
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DuplicateAlertError);
    expect((caught as DuplicateAlertError).existingAlertId).toBe('existing-id');
  });

  it('scanner trigger failure → Alert still created, WARN logged', async () => {
    mockedFetchUrl.mockResolvedValueOnce({ text: 'content' });

    // Make trigger fail.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));

    const prismaMock = makePrismaMock();
    const envMock = makeEnvMock();
    const service = makeService(prismaMock, envMock);
    const warnSpy = vi.spyOn(
      (service as unknown as { logger: { warn: (m: string) => void } }).logger,
      'warn',
    );

    const result = await service.ingestUrl(
      { type: 'url', url: 'https://example.com/x', jurisdiction: 'CO' },
      'org-2',
    );

    expect(result.alertId).toBe('alert-123');
    // Wait a tick for the fire-and-forget to reject.
    await new Promise((r) => setTimeout(r, 10));
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('IngestService.ingestText', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  it('happy path: creates Alert from text', async () => {
    const prismaMock = makePrismaMock();
    const service = makeService(prismaMock);

    const result = await service.ingestText(
      { type: 'text', text: 'some regulation text', title: 'Reg Title', jurisdiction: 'CL' },
      'org-3',
    );

    expect(result.alertId).toBe('alert-123');
    const createArgs = (
      prismaMock.alert.create.mock.calls as { data: Record<string, unknown> }[][]
    )[0]?.[0];
    expect(createArgs?.data.source).toBe('MANUAL');
    expect(createArgs?.data.jurisdiction).toBe('CL');
    expect(createArgs?.data.sourceUrl).toMatch(/^manual:text:/);
  });
});

describe('IngestService.ingestPdf', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  it('happy path: extracts PDF text, creates Alert', async () => {
    mockedExtractPdfText.mockResolvedValueOnce('pdf content here');

    const prismaMock = makePrismaMock();
    const service = makeService(prismaMock);

    const buffer = Buffer.from('fake-pdf');
    const result = await service.ingestPdf(
      buffer,
      'regulation.pdf',
      { jurisdiction: 'PE' },
      'org-4',
    );

    expect(result.alertId).toBe('alert-123');
    const createArgs = (
      prismaMock.alert.create.mock.calls as { data: Record<string, unknown> }[][]
    )[0]?.[0];
    expect(createArgs?.data.source).toBe('MANUAL');
    expect(createArgs?.data.sourceUrl).toBe('manual:pdf:regulation.pdf');
  });
});
