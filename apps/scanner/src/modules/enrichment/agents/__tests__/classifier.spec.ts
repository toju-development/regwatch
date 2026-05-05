/**
 * Tests for Classifier agent: factory, runner, trust boundary, prompt regression.
 *
 * Spec: `sdd/classifier-and-writer/spec` R-1-Classifier-Output-Contract,
 *   R-6-Trust-Boundary, INV-AE-4 (no hardcoded AlertTopic literals).
 * Design: `sdd/classifier-and-writer/design` ADR-4, ADR-11.
 *
 * Test strategy (mirrors MVP-5 `jurisdiction-scanner.factory.spec.ts`):
 *   - Stub `GoogleGenAI.models.generateContent` with `vi.fn()` — no network.
 *   - Test prompt builder in isolation (pure function).
 *   - Test runner through the full Zod + walker pipeline.
 *   - Dedicated prompt-regression suite (INV-AE-4 guard, defuses #798).
 */
import { describe, expect, it, vi } from 'vitest';

import { AlertTopic, type AlertTopicValue } from '@regwatch/types';

import { buildClassifierPrompt, createClassifierAgentFactory } from '../classifier.factory.js';
import { runClassifier } from '../classifier.runner.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ALL_TOPICS = Object.values(AlertTopic) as AlertTopicValue[];

const SAMPLE_ALERT = {
  id: 'alert-001',
  title: 'BCRA Comunicación A 7890 - Reservas mínimas',
  summary:
    'El Banco Central de la República Argentina establece nuevos requisitos de reservas mínimas ' +
    'para entidades financieras. Las instituciones deberán mantener un encaje del 15% sobre ' +
    'depósitos a la vista a partir del 1 de junio de 2026.',
  sourceId: 'BCRA_COMUNICADOS_A',
};

/** Build a mock GoogleGenAI client that returns fixed text + usage. */
function makeClient(
  text: string,
  usage = { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
) {
  const generateContent = vi.fn().mockResolvedValue({ text, usageMetadata: usage });
  return {
    client: { models: { generateContent } } as unknown as Parameters<
      typeof createClassifierAgentFactory
    >[0],
    generateContent,
  };
}

/** Build a ClassifierAgent that returns a fixed raw JSON string. */
function makeAgent(jsonText: string): ClassifierAgent {
  return {
    model: 'gemini-2.5-flash',
    call: vi.fn().mockResolvedValue({ rawText: jsonText, tokensIn: 100, tokensOut: 50 }),
  };
}

const VALID_OUTPUT = {
  topic: 'CAPITAL_REQUIREMENTS',
  severity: 'HIGH',
  relevanceScore: 85,
  relevant: true,
};

// ─── buildClassifierPrompt ────────────────────────────────────────────────────

describe('buildClassifierPrompt', () => {
  it('includes alert fields in the prompt', () => {
    const prompt = buildClassifierPrompt(SAMPLE_ALERT, ALL_TOPICS, 'es');
    expect(prompt).toContain(SAMPLE_ALERT.title);
    expect(prompt).toContain(SAMPLE_ALERT.summary);
    expect(prompt).toContain(SAMPLE_ALERT.sourceId);
  });

  it('injects all provided topics into the allowed list', () => {
    const topics: AlertTopicValue[] = ['FX', 'AML', 'CAPITAL_REQUIREMENTS'];
    const prompt = buildClassifierPrompt(SAMPLE_ALERT, topics, 'es');
    for (const t of topics) {
      expect(prompt).toContain(t);
    }
  });

  it('contains the word JSON (structured output instruction)', () => {
    const prompt = buildClassifierPrompt(SAMPLE_ALERT, ALL_TOPICS, 'es');
    expect(prompt).toContain('JSON');
  });

  it('includes language hint', () => {
    const prompt = buildClassifierPrompt(SAMPLE_ALERT, ALL_TOPICS, 'pt');
    expect(prompt).toContain('pt');
  });

  it('mentions security rule against organizationId', () => {
    const prompt = buildClassifierPrompt(SAMPLE_ALERT, ALL_TOPICS, 'en');
    expect(prompt).toContain('organizationId');
  });

  it('shows (none provided) when topics list is empty', () => {
    const prompt = buildClassifierPrompt(SAMPLE_ALERT, [], 'en');
    expect(prompt).toContain('(none provided)');
  });
});

// ─── createClassifierAgentFactory ─────────────────────────────────────────────

describe('createClassifierAgentFactory', () => {
  it('builds an agent with the default model', () => {
    const { client } = makeClient(JSON.stringify(VALID_OUTPUT));
    const factory = createClassifierAgentFactory(client);
    const agent = factory();
    expect(agent.model).toBe('gemini-2.5-flash');
  });

  it('honors model override', () => {
    const { client } = makeClient(JSON.stringify(VALID_OUTPUT));
    const factory = createClassifierAgentFactory(client);
    const agent = factory({ model: 'gemini-2.5-pro' });
    expect(agent.model).toBe('gemini-2.5-pro');
  });

  it('calls generateContent once and returns rawText + token counts', async () => {
    const usage = { promptTokenCount: 200, candidatesTokenCount: 80, totalTokenCount: 280 };
    const { client, generateContent } = makeClient(JSON.stringify(VALID_OUTPUT), usage);
    const factory = createClassifierAgentFactory(client);
    const agent = factory();

    const result = await agent.call(SAMPLE_ALERT, ALL_TOPICS, 'es');

    expect(generateContent).toHaveBeenCalledOnce();
    expect(result.rawText).toBe(JSON.stringify(VALID_OUTPUT));
    expect(result.tokensIn).toBe(200);
    expect(result.tokensOut).toBe(80);
  });

  it('does NOT use googleSearch tool (responseSchema is incompatible with grounding)', async () => {
    const { client, generateContent } = makeClient(JSON.stringify(VALID_OUTPUT));
    const factory = createClassifierAgentFactory(client);
    const agent = factory();
    await agent.call(SAMPLE_ALERT, ALL_TOPICS, 'es');

    const callArgs = generateContent.mock.calls[0]?.[0];
    expect(callArgs?.config?.tools).toBeUndefined();
    expect(callArgs?.config?.responseMimeType).toBe('application/json');
    expect(callArgs?.config?.responseSchema).toBeDefined();
    expect(callArgs?.config?.temperature).toBe(0);
  });

  it('sets temperature to 0 for deterministic classification', async () => {
    const { client, generateContent } = makeClient(JSON.stringify(VALID_OUTPUT));
    const factory = createClassifierAgentFactory(client);
    const agent = factory();
    await agent.call(SAMPLE_ALERT, ALL_TOPICS, 'es');

    const callArgs = generateContent.mock.calls[0]?.[0];
    expect(callArgs?.config?.temperature).toBe(0);
  });
});

// ─── runClassifier (happy path) ───────────────────────────────────────────────

describe('runClassifier — happy path', () => {
  it('returns parsed ClassifierOutput on valid JSON', async () => {
    const agent = makeAgent(JSON.stringify(VALID_OUTPUT));
    const result = await runClassifier(agent, SAMPLE_ALERT, ALL_TOPICS, 'es');

    expect(result.output.topic).toBe('CAPITAL_REQUIREMENTS');
    expect(result.output.severity).toBe('HIGH');
    expect(result.output.relevanceScore).toBe(85);
    expect(result.output.relevant).toBe(true);
    expect(result.tokensIn).toBe(100);
    expect(result.tokensOut).toBe(50);
  });

  it('relevant=false path: output is still valid (filtering is EnrichmentService concern)', async () => {
    const irrelevant = { ...VALID_OUTPUT, relevant: false, relevanceScore: 10 };
    const agent = makeAgent(JSON.stringify(irrelevant));
    const result = await runClassifier(agent, SAMPLE_ALERT, ALL_TOPICS, 'es');

    expect(result.output.relevant).toBe(false);
    expect(result.output.relevanceScore).toBe(10);
  });

  it('parses every valid AlertTopic value', async () => {
    for (const topic of ALL_TOPICS) {
      const output = { ...VALID_OUTPUT, topic };
      const agent = makeAgent(JSON.stringify(output));
      const result = await runClassifier(agent, SAMPLE_ALERT, ALL_TOPICS, 'es');
      expect(result.output.topic).toBe(topic);
    }
  });
});

// ─── runClassifier (schema rejection — fence 1: Zod .strict()) ───────────────

describe('runClassifier — schema rejection (Zod fence)', () => {
  it('rejects extra field organizationId via Zod .strict() before walker runs', async () => {
    const withOrgId = { ...VALID_OUTPUT, organizationId: 'org-evil' };
    const agent = makeAgent(JSON.stringify(withOrgId));
    await expect(runClassifier(agent, SAMPLE_ALERT, ALL_TOPICS, 'es')).rejects.toThrow();
  });

  it('rejects unknown field "alertId" via Zod .strict()', async () => {
    const withAlertId = { ...VALID_OUTPUT, alertId: 'alert-injected' };
    const agent = makeAgent(JSON.stringify(withAlertId));
    await expect(runClassifier(agent, SAMPLE_ALERT, ALL_TOPICS, 'es')).rejects.toThrow();
  });

  it('rejects topic not in the AlertTopic enum', async () => {
    const badTopic = { ...VALID_OUTPUT, topic: 'FINTECH_GENERAL' };
    const agent = makeAgent(JSON.stringify(badTopic));
    await expect(runClassifier(agent, SAMPLE_ALERT, ALL_TOPICS, 'es')).rejects.toThrow();
  });

  it('rejects relevanceScore above 100', async () => {
    const badScore = { ...VALID_OUTPUT, relevanceScore: 101 };
    const agent = makeAgent(JSON.stringify(badScore));
    await expect(runClassifier(agent, SAMPLE_ALERT, ALL_TOPICS, 'es')).rejects.toThrow();
  });

  it('rejects relevanceScore below 0', async () => {
    const badScore = { ...VALID_OUTPUT, relevanceScore: -1 };
    const agent = makeAgent(JSON.stringify(badScore));
    await expect(runClassifier(agent, SAMPLE_ALERT, ALL_TOPICS, 'es')).rejects.toThrow();
  });

  it('rejects non-integer relevanceScore', async () => {
    const badScore = { ...VALID_OUTPUT, relevanceScore: 85.5 };
    const agent = makeAgent(JSON.stringify(badScore));
    await expect(runClassifier(agent, SAMPLE_ALERT, ALL_TOPICS, 'es')).rejects.toThrow();
  });

  it('rejects severity not in LOW|MEDIUM|HIGH|CRITICAL', async () => {
    const badSeverity = { ...VALID_OUTPUT, severity: 'UNKNOWN' };
    const agent = makeAgent(JSON.stringify(badSeverity));
    await expect(runClassifier(agent, SAMPLE_ALERT, ALL_TOPICS, 'es')).rejects.toThrow();
  });

  it('rejects invalid JSON from Gemini (SyntaxError)', async () => {
    const agent = makeAgent('not valid json at all');
    await expect(runClassifier(agent, SAMPLE_ALERT, ALL_TOPICS, 'es')).rejects.toThrow(SyntaxError);
  });
});

// ─── runClassifier (trust-boundary walker — fence 2: assertNoForbiddenKeys) ───

describe('runClassifier — trust-boundary walker (fence 2)', () => {
  it('throws when organizationId is present (simulates schema regression bypassing Zod)', async () => {
    // Since Zod .strict() (fence 1) catches forbidden keys before the walker,
    // we verify fence 2 (assertNoForbiddenKeys) via direct call — simulating
    // a schema regression that accidentally lets a forbidden key through a nested shape.
    const { assertNoForbiddenKeys } = await import('@regwatch/types');
    const poisoned = { ...VALID_OUTPUT, organizationId: 'org-injected' };
    expect(() => assertNoForbiddenKeys(poisoned, ['organizationId', 'userId', 'email'])).toThrow(
      /organizationId/,
    );
  });
});
