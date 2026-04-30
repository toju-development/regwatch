/**
 * Unit tests for `JurisdictionScannerFactory`.
 *
 * Mocks `GoogleGenAI.models.generateContent` so the suite never hits the
 * network. Asserts model id, prompt shape, JSON parsing (with/without code
 * fences), and Zod validation hook-up.
 *
 * Spec: sdd/scanner-vertical-ar/spec R-1, R-2, R-9.
 * Design: sdd/scanner-vertical-ar/design ADR-2.
 */
import { describe, expect, it, vi } from 'vitest';

import { AR_SOURCES } from '../sources/ar.js';
import {
  buildPrompt,
  createJurisdictionScannerFactory,
  parseFindingsFromText,
} from './jurisdiction-scanner.factory.js';

function makeClient(
  text: string,
  usage = { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
) {
  const generateContent = vi.fn().mockResolvedValue({ text, usageMetadata: usage });
  return {
    client: { models: { generateContent } } as unknown as Parameters<
      typeof createJurisdictionScannerFactory
    >[0],
    generateContent,
  };
}

describe('buildPrompt', () => {
  it('lists every source in stable order', () => {
    const { systemInstruction, userText } = buildPrompt('AR', AR_SOURCES);
    expect(systemInstruction).toContain('regulatory-watch analyst');
    expect(userText).toContain('Jurisdiction: AR');
    for (const s of AR_SOURCES) {
      expect(userText).toContain(s.regulator);
      expect(userText).toContain(s.searchUrl);
    }
  });

  it('includes since-date hint when provided', () => {
    const { userText } = buildPrompt('AR', AR_SOURCES, {
      sinceDate: new Date('2026-01-15T00:00:00Z'),
    });
    expect(userText).toContain('2026-01-15');
  });

  it('includes custom topics when provided', () => {
    const { userText } = buildPrompt('AR', AR_SOURCES, { customTopics: 'fintech, crypto' });
    expect(userText).toContain('fintech, crypto');
  });

  it('forbids organizationId in the system instruction (R-3)', () => {
    const { systemInstruction } = buildPrompt('AR', AR_SOURCES);
    expect(systemInstruction).toMatch(/NEVER include an `organizationId`/);
  });
});

describe('parseFindingsFromText', () => {
  const valid = JSON.stringify({
    findings: [
      {
        source: 'BCRA_COMUNICADOS_A',
        sourceUrl: 'https://www.bcra.gob.ar/foo',
        title: 'Comunicación A 1234',
        summary: 'A test summary',
      },
    ],
  });

  it('parses bare JSON', () => {
    const out = parseFindingsFromText(valid);
    expect(out).toHaveLength(1);
    expect(out[0]?.source).toBe('BCRA_COMUNICADOS_A');
  });

  it('strips ```json fences', () => {
    const out = parseFindingsFromText('```json\n' + valid + '\n```');
    expect(out).toHaveLength(1);
  });

  it('strips bare ``` fences', () => {
    const out = parseFindingsFromText('```\n' + valid + '\n```');
    expect(out).toHaveLength(1);
  });

  it('throws on non-JSON', () => {
    expect(() => parseFindingsFromText('totally not json')).toThrow();
  });

  it('throws on schema-invalid JSON', () => {
    expect(() => parseFindingsFromText('{"findings":[{"source":"NOT_A_SOURCE"}]}')).toThrow();
  });
});

describe('createJurisdictionScannerFactory', () => {
  it('builds a scanner with the default model and source list', async () => {
    const { client, generateContent } = makeClient(JSON.stringify({ findings: [] }));
    const factory = createJurisdictionScannerFactory(client);
    const scanner = factory({ jurisdiction: 'AR', sources: AR_SOURCES });

    expect(scanner.jurisdiction).toBe('AR');
    expect(scanner.model).toBe('gemini-2.5-flash');
    expect(scanner.sources).toBe(AR_SOURCES);

    const result = await scanner.run();
    expect(result.findings).toEqual([]);
    expect(result.usageMetadata.totalTokenCount).toBe(30);
    expect(generateContent).toHaveBeenCalledOnce();

    const callArgs = generateContent.mock.calls[0]?.[0];
    expect(callArgs.model).toBe('gemini-2.5-flash');
    expect(callArgs.config.tools).toEqual([{ googleSearch: {} }]);
    expect(callArgs.config.temperature).toBe(0);
    expect(callArgs.config.systemInstruction).toContain('regulatory-watch analyst');
  });

  it('returns parsed findings + usageMetadata on a happy response', async () => {
    const text = JSON.stringify({
      findings: [
        {
          source: 'CNV_RESOLUCIONES_GENERALES',
          sourceUrl: 'https://www.cnv.gov.ar/sitiocnv/x',
          title: 'Resolución General 999',
          summary: 'Body',
        },
      ],
    });
    const { client } = makeClient('```json\n' + text + '\n```');
    const factory = createJurisdictionScannerFactory(client);
    const scanner = factory({ jurisdiction: 'AR', sources: AR_SOURCES });
    const out = await scanner.run();
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]?.source).toBe('CNV_RESOLUCIONES_GENERALES');
  });

  it('honors a model override', async () => {
    const { client } = makeClient(JSON.stringify({ findings: [] }));
    const factory = createJurisdictionScannerFactory(client);
    const scanner = factory({ jurisdiction: 'AR', sources: AR_SOURCES, model: 'gemini-2.5-pro' });
    expect(scanner.model).toBe('gemini-2.5-pro');
  });
});
