/**
 * Tests for Writer agent: factory, runner, trust boundary, citation validation.
 *
 * Spec: `sdd/classifier-and-writer/spec` R-2-Writer-Output-Contract,
 *   R-4-Output-Language-Resolution, R-6-Trust-Boundary.
 * Design: `sdd/classifier-and-writer/design` ADR-5 (citation atomic reject),
 *   ADR-11 (trust boundary: Zod .strict() → assertNoForbiddenKeys → citations).
 *
 * Test strategy (mirrors classifier.spec.ts — MVP-5 pattern):
 *   - Stub `WriterAgent.call` with `vi.fn()` — no network.
 *   - Test prompt builder in isolation (pure function).
 *   - Test runner through the full Zod + walker + citation-validation pipeline.
 *   - `relevant=false` skip scenario is NOT tested here (EnrichmentService concern — B5).
 */
import { describe, expect, it, vi } from 'vitest';

import { buildWriterPrompt, createWriterAgentFactory } from '../writer.factory.js';
import type { WriterAgent } from '../writer.factory.js';
import { runWriter, WriterCitationError } from '../writer.runner.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SOURCE_TEXT =
  'El Banco Central de la República Argentina establece nuevos requisitos de reservas mínimas ' +
  'para entidades financieras. Las instituciones deberán mantener un encaje del 15% sobre ' +
  'depósitos a la vista a partir del 1 de junio de 2026.';

const SAMPLE_ALERT = {
  id: 'alert-001',
  title: 'BCRA Comunicación A 7890 - Reservas mínimas',
  summary: SOURCE_TEXT,
  topic: 'CAPITAL_REQUIREMENTS',
  severity: 'HIGH',
};

/** Build a mock GoogleGenAI client that returns fixed text + usage. */
function makeClient(
  text: string,
  usage = { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
) {
  const generateContent = vi.fn().mockResolvedValue({ text, usageMetadata: usage });
  return {
    client: { models: { generateContent } } as unknown as Parameters<
      typeof createWriterAgentFactory
    >[0],
    generateContent,
  };
}

/** Build a WriterAgent that returns a fixed raw JSON string. */
function makeAgent(jsonText: string): WriterAgent {
  return {
    model: 'gemini-2.5-flash',
    call: vi.fn().mockResolvedValue({ rawText: jsonText, tokensIn: 100, tokensOut: 50 }),
  };
}

/** Build a valid WriterOutput using citations from SOURCE_TEXT. */
const VALID_OUTPUT = {
  executiveSummary:
    'El Banco Central de la República Argentina ha publicado nuevos requisitos de encaje. ' +
    'Las entidades deberán mantener un encaje del 15% sobre depósitos a la vista. ' +
    'La norma entra en vigencia el 1 de junio de 2026.',
  whatChangesForYou:
    'Las fintechs con depósitos a la vista deben ajustar sus niveles de encaje antes del 1 de junio.',
  citations: [
    // These are verbatim (case-insensitive + collapsed-whitespace) substrings of SOURCE_TEXT
    'nuevos requisitos de reservas mínimas',
    'encaje del 15%',
  ],
};

// ─── buildWriterPrompt ────────────────────────────────────────────────────────

describe('buildWriterPrompt', () => {
  it('includes alert fields in the prompt', () => {
    const prompt = buildWriterPrompt(SAMPLE_ALERT, 'es');
    expect(prompt).toContain(SAMPLE_ALERT.title);
    expect(prompt).toContain(SAMPLE_ALERT.summary);
    expect(prompt).toContain(SAMPLE_ALERT.topic);
    expect(prompt).toContain(SAMPLE_ALERT.severity);
  });

  it('includes JSON output instruction', () => {
    const prompt = buildWriterPrompt(SAMPLE_ALERT, 'es');
    expect(prompt).toContain('JSON');
  });

  it('mentions security rule against organizationId', () => {
    const prompt = buildWriterPrompt(SAMPLE_ALERT, 'en');
    expect(prompt).toContain('organizationId');
  });

  it('stresses citation verbatim constraint in prompt', () => {
    const prompt = buildWriterPrompt(SAMPLE_ALERT, 'en');
    expect(prompt).toContain('verbatim');
  });

  it('language es — prompt contains Spanish language instruction', () => {
    const prompt = buildWriterPrompt(SAMPLE_ALERT, 'es');
    expect(prompt).toContain('Spanish');
  });

  it('language pt — prompt contains Portuguese language instruction', () => {
    const prompt = buildWriterPrompt(SAMPLE_ALERT, 'pt');
    expect(prompt).toContain('Portuguese');
  });

  it('language en — prompt contains English language instruction', () => {
    const prompt = buildWriterPrompt(SAMPLE_ALERT, 'en');
    expect(prompt).toContain('English');
  });
});

// ─── createWriterAgentFactory ──────────────────────────────────────────────────

describe('createWriterAgentFactory', () => {
  it('builds an agent with the default model', () => {
    const { client } = makeClient(JSON.stringify(VALID_OUTPUT));
    const factory = createWriterAgentFactory(client);
    const agent = factory();
    expect(agent.model).toBe('gemini-2.5-flash');
  });

  it('honors model override', () => {
    const { client } = makeClient(JSON.stringify(VALID_OUTPUT));
    const factory = createWriterAgentFactory(client);
    const agent = factory({ model: 'gemini-2.5-pro' });
    expect(agent.model).toBe('gemini-2.5-pro');
  });

  it('calls generateContent once and returns rawText + token counts', async () => {
    const usage = { promptTokenCount: 200, candidatesTokenCount: 80, totalTokenCount: 280 };
    const { client, generateContent } = makeClient(JSON.stringify(VALID_OUTPUT), usage);
    const factory = createWriterAgentFactory(client);
    const agent = factory();

    const result = await agent.call(SAMPLE_ALERT, 'es');

    expect(generateContent).toHaveBeenCalledOnce();
    expect(result.rawText).toBe(JSON.stringify(VALID_OUTPUT));
    expect(result.tokensIn).toBe(200);
    expect(result.tokensOut).toBe(80);
  });

  it('does NOT use googleSearch tool (responseSchema is incompatible with grounding)', async () => {
    const { client, generateContent } = makeClient(JSON.stringify(VALID_OUTPUT));
    const factory = createWriterAgentFactory(client);
    const agent = factory();
    await agent.call(SAMPLE_ALERT, 'es');

    const callArgs = generateContent.mock.calls[0]?.[0];
    expect(callArgs?.config?.tools).toBeUndefined();
    expect(callArgs?.config?.responseMimeType).toBe('application/json');
    expect(callArgs?.config?.responseSchema).toBeDefined();
    expect(callArgs?.config?.temperature).toBe(0);
  });

  it('sets temperature to 0 for deterministic output', async () => {
    const { client, generateContent } = makeClient(JSON.stringify(VALID_OUTPUT));
    const factory = createWriterAgentFactory(client);
    const agent = factory();
    await agent.call(SAMPLE_ALERT, 'en');

    const callArgs = generateContent.mock.calls[0]?.[0];
    expect(callArgs?.config?.temperature).toBe(0);
  });
});

// ─── runWriter (happy path) ───────────────────────────────────────────────────

describe('runWriter — happy path', () => {
  it('returns parsed WriterOutput on valid JSON with valid citations', async () => {
    const agent = makeAgent(JSON.stringify(VALID_OUTPUT));
    const result = await runWriter(agent, SAMPLE_ALERT, 'es', SOURCE_TEXT);

    expect(result.output.executiveSummary).toBe(VALID_OUTPUT.executiveSummary);
    expect(result.output.whatChangesForYou).toBe(VALID_OUTPUT.whatChangesForYou);
    expect(result.output.citations).toEqual(VALID_OUTPUT.citations);
    expect(result.tokensIn).toBe(100);
    expect(result.tokensOut).toBe(50);
  });

  it('passes when citations match source text (normalized: case-insensitive, whitespace collapsed)', async () => {
    const withUpperCaseCitation = {
      ...VALID_OUTPUT,
      citations: ['NUEVOS REQUISITOS DE RESERVAS MÍNIMAS'],
    };
    const agent = makeAgent(JSON.stringify(withUpperCaseCitation));
    // Should NOT throw — citation validator normalizes both sides
    const result = await runWriter(agent, SAMPLE_ALERT, 'es', SOURCE_TEXT);
    expect(result.output.citations).toEqual(withUpperCaseCitation.citations);
  });
});

// ─── runWriter (citation validation failure — fence 3: validateCitations) ────

describe('runWriter — citation validation (fence 3)', () => {
  it('throws WriterCitationError when citation is NOT a substring of sourceText', async () => {
    const withBadCitation = {
      ...VALID_OUTPUT,
      citations: ['this text does not appear anywhere in the source'],
    };
    const agent = makeAgent(JSON.stringify(withBadCitation));
    await expect(runWriter(agent, SAMPLE_ALERT, 'es', SOURCE_TEXT)).rejects.toThrow(
      WriterCitationError,
    );
  });

  it('WriterCitationError.offending contains the failing citation', async () => {
    const offendingCitation = 'hallucinated content not in source';
    const withBadCitation = { ...VALID_OUTPUT, citations: [offendingCitation] };
    const agent = makeAgent(JSON.stringify(withBadCitation));

    await expect(runWriter(agent, SAMPLE_ALERT, 'es', SOURCE_TEXT)).rejects.toMatchObject({
      offending: offendingCitation,
    });
  });

  it('throws on first failing citation (atomic reject — ADR-5)', async () => {
    const firstOffending = 'first hallucinated citation';
    const withMixedCitations = {
      ...VALID_OUTPUT,
      citations: [
        firstOffending,
        'nuevos requisitos de reservas mínimas', // valid
      ],
    };
    const agent = makeAgent(JSON.stringify(withMixedCitations));

    await expect(runWriter(agent, SAMPLE_ALERT, 'es', SOURCE_TEXT)).rejects.toMatchObject({
      offending: firstOffending,
    });
  });
});

// ─── Empty citations (validateCitations pure-function contract) ───────────────

describe('empty citations array — citation validator behavior', () => {
  it('validateCitations returns valid=true for empty array (no citations to check)', async () => {
    // The citation validator contract: empty array → valid (citation.validator.ts, line 46-48).
    // NOTE: WriterOutputSchema.min(1) would reject empty citations at the Zod boundary BEFORE
    // citation validation runs. This test validates the validator's own contract directly.
    const { validateCitations } = await import('../../utils/citation.validator.js');
    const result = validateCitations([], SOURCE_TEXT);
    expect(result.valid).toBe(true);
    expect(result.offending).toBeNull();
  });
});

// ─── runWriter (schema rejection — fence 1: Zod .strict()) ───────────────────

describe('runWriter — schema rejection (Zod fence)', () => {
  it('rejects extra field organizationId via Zod .strict()', async () => {
    const withOrgId = { ...VALID_OUTPUT, organizationId: 'org-evil' };
    const agent = makeAgent(JSON.stringify(withOrgId));
    await expect(runWriter(agent, SAMPLE_ALERT, 'es', SOURCE_TEXT)).rejects.toThrow();
  });

  it('rejects extra field alertId via Zod .strict()', async () => {
    const withAlertId = { ...VALID_OUTPUT, alertId: 'alert-injected' };
    const agent = makeAgent(JSON.stringify(withAlertId));
    await expect(runWriter(agent, SAMPLE_ALERT, 'es', SOURCE_TEXT)).rejects.toThrow();
  });

  it('rejects executiveSummary shorter than 50 chars (Zod min guard)', async () => {
    const tooShort = { ...VALID_OUTPUT, executiveSummary: 'Too short.' };
    const agent = makeAgent(JSON.stringify(tooShort));
    await expect(runWriter(agent, SAMPLE_ALERT, 'es', SOURCE_TEXT)).rejects.toThrow();
  });

  it('rejects invalid JSON from Gemini (SyntaxError)', async () => {
    const agent = makeAgent('not valid json at all');
    await expect(runWriter(agent, SAMPLE_ALERT, 'es', SOURCE_TEXT)).rejects.toThrow(SyntaxError);
  });
});

// ─── runWriter (trust-boundary walker — fence 2: assertNoForbiddenKeys) ───────

describe('runWriter — trust-boundary walker (fence 2)', () => {
  it('throws when organizationId is present (simulates schema regression bypassing Zod)', async () => {
    // Fence 1 (Zod .strict()) catches organizationId before the walker runs in normal flow.
    // We test fence 2 directly — simulating a schema regression that accidentally allows it.
    const { assertNoForbiddenKeys } = await import('@regwatch/types');
    const poisoned = { ...VALID_OUTPUT, organizationId: 'org-injected' };
    expect(() => assertNoForbiddenKeys(poisoned, ['organizationId', 'userId', 'email'])).toThrow(
      /organizationId/,
    );
  });
});

// ─── Language integration ──────────────────────────────────────────────────────

describe('runWriter — language respected in prompt', () => {
  it('prompt built with "pt" contains Portuguese language instruction', async () => {
    const { client, generateContent } = makeClient(JSON.stringify(VALID_OUTPUT));
    const factory = createWriterAgentFactory(client);
    const agent = factory();

    await agent.call(SAMPLE_ALERT, 'pt');

    const callArgs = generateContent.mock.calls[0]?.[0];
    expect(callArgs?.contents).toContain('Portuguese');
  });

  it('prompt built with "es" contains Spanish language instruction', async () => {
    const { client, generateContent } = makeClient(JSON.stringify(VALID_OUTPUT));
    const factory = createWriterAgentFactory(client);
    const agent = factory();

    await agent.call(SAMPLE_ALERT, 'es');

    const callArgs = generateContent.mock.calls[0]?.[0];
    expect(callArgs?.contents).toContain('Spanish');
  });
});
