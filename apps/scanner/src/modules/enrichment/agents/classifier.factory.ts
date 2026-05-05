/**
 * Classifier agent factory for alert enrichment.
 *
 * Builds a callable Gemini agent that classifies regulatory alerts into
 * structured metadata: topic, severity, relevanceScore, relevant.
 *
 * Spec: `sdd/classifier-and-writer/spec` R-1-Classifier-Output-Contract, INV-AE-4.
 * Design: `sdd/classifier-and-writer/design` ADR-3 (universal factory — NOT
 *   per-jurisdiction like MVP-5), ADR-4 (AlertTopic injected dynamically —
 *   ZERO literals in prompt template).
 *
 * KEY DIFFERENCES FROM MVP-5 `JurisdictionScannerFactory`:
 *   - Does NOT use `googleSearch` — content already fetched; no grounding needed.
 *   - Uses `responseSchema` for structured JSON output (googleSearch + responseSchema
 *     are mutually exclusive — 400 error from Gemini API; see scanner factory comment).
 *   - Universal factory: jurisdiction/topics/language are runtime params,
 *     NOT factory construction params (ADR-3 rationale: taxonomy is global).
 *
 * SECURITY INVARIANT (INV-AE-4 / ADR-4):
 *   The prompt template MUST contain ZERO hardcoded AlertTopic literal values.
 *   Topics are injected EXCLUSIVELY via the `topics` parameter at call time.
 *   Regression test in `__tests__/classifier.spec.ts` guards this invariant by
 *   calling `buildClassifierPrompt` with an empty `topics` array and asserting
 *   that no AlertTopic code appears in the output.
 */
import type { GoogleGenAI } from '@google/genai';

import type { AlertTopicValue } from '@regwatch/types';

import type { OutputLanguage } from '../utils/language.helper.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';

/**
 * Build the Classifier prompt as a `{ systemInstruction, userText }` pair.
 *
 * Exported for unit tests so prompt drift and INV-AE-4 are detectable without
 * an HTTP call. Follow the same testability pattern as MVP-5 `buildPrompt`.
 *
 * @param alert    - Alert metadata (title, summary, sourceId). NEVER include orgId.
 * @param topics   - AlertTopic values injected at runtime. May be empty (regression
 *                   test only); the prompt will surface '(none provided)' but
 *                   will still contain NO hardcoded topic codes.
 * @param language - Resolved output language for any explanatory context.
 *                   ClassifierOutput has no user-facing text fields, but the
 *                   language hint helps calibrate Gemini's internal reasoning.
 */
export function buildClassifierPrompt(
  alert: { title: string; summary: string; sourceId: string },
  topics: AlertTopicValue[],
  language: OutputLanguage,
): string {
  const topicList = topics.length > 0 ? topics.join(', ') : '(none provided)';

  const lines = [
    'You are a regulatory classification expert for a fintech compliance platform.',
    'Classify the provided regulatory alert into structured JSON metadata.',
    '',
    'OUTPUT: Return ONLY a valid JSON object matching this shape exactly:',
    '{',
    '  "topic": <one value from the Allowed Topics list below>,',
    '  "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",',
    '  "relevanceScore": <integer 0–100>,',
    '  "relevant": <boolean>',
    '}',
    '',
    'CLASSIFICATION RULES:',
    '  - topic: pick EXACTLY one value from the Allowed Topics list below. If no topic clearly applies, pick the closest match from the list.',
    '  - severity: regulatory impact — LOW=informational, MEDIUM=attention needed, HIGH=action required, CRITICAL=urgent compliance deadline.',
    '  - relevanceScore: 0–100 integer. How relevant is this regulation for a fintech operating in the jurisdiction? 0=not relevant, 100=maximum relevance.',
    '  - relevant: true when relevanceScore >= 30, false otherwise.',
    `  - Context language: ${language} (calibrate relevance judgement for this market).`,
    '',
    'SECURITY RULES:',
    '  - NEVER include organizationId, userId, email, or any tenant identifier in the output.',
    '  - NEVER fabricate information not present in the alert.',
    '  - Output ONLY the JSON object — no markdown fences, no prose, no commentary.',
    '',
    `SOURCE: ${alert.sourceId}`,
    `TITLE: ${alert.title}`,
    `SUMMARY: ${alert.summary}`,
    '',
    `Allowed Topics: ${topicList}`,
    '',
    'Return the JSON object now.',
  ];

  return lines.join('\n');
}

/**
 * Inline JSON Schema equivalent of `ClassifierOutputSchema` for Gemini
 * `responseSchema`. Topics are injected dynamically so the schema's `topic.enum`
 * matches whatever topics were provided at call time.
 *
 * NOTE: If `topics` is empty (regression test), we fall back to `['OTHER']` so
 * the schema remains valid (Gemini rejects an empty enum array).
 */
function buildResponseSchema(topics: AlertTopicValue[]) {
  return {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        enum: topics.length > 0 ? [...topics] : ['OTHER'],
      },
      severity: {
        type: 'string',
        enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      },
      relevanceScore: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
      },
      relevant: {
        type: 'boolean',
      },
    },
    required: ['topic', 'severity', 'relevanceScore', 'relevant'],
    additionalProperties: false,
  };
}

/** Raw result from a single Gemini Classifier call (pre-Zod). */
export interface ClassifierRawResult {
  rawText: string;
  tokensIn: number;
  tokensOut: number;
}

/** Callable Classifier agent produced by the factory. */
export interface ClassifierAgent {
  readonly model: string;
  /**
   * Invoke Gemini and return the raw response text + token counts.
   * Does NOT parse or validate — `runClassifier` handles that.
   */
  call(
    alert: { title: string; summary: string; sourceId: string },
    topics: AlertTopicValue[],
    language: OutputLanguage,
  ): Promise<ClassifierRawResult>;
}

export interface BuildClassifierAgentOpts {
  /** Override model id (default: `gemini-2.5-flash`). */
  model?: string;
}

/**
 * Create the Classifier agent factory backed by a Gemini client.
 *
 * Pattern mirrors `createJurisdictionScannerFactory` from MVP-5:
 *   `const factory = createClassifierAgentFactory(client)`
 *   `const agent = factory(opts)`
 *   `const raw = await agent.call(alert, topics, language)`
 *
 * Pure factory — does NOT do I/O at construction time (safe for DI bootstrap).
 * Inject the result as `CLASSIFIER_AGENT_FACTORY` token.
 */
export function createClassifierAgentFactory(client: GoogleGenAI) {
  return function build(opts: BuildClassifierAgentOpts = {}): ClassifierAgent {
    const model = opts.model ?? DEFAULT_MODEL;

    return {
      model,
      async call(alert, topics, language) {
        const prompt = buildClassifierPrompt(alert, topics, language);
        const response = await client.models.generateContent({
          model,
          contents: prompt,
          config: {
            // responseSchema for structured output. Do NOT add googleSearch here —
            // they are mutually exclusive (foot-gun from MVP-5 — 400 from Gemini API).
            responseMimeType: 'application/json',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            responseSchema: buildResponseSchema(topics) as any,
            temperature: 0,
          },
        });

        const rawText = response.text ?? '';
        const usage = response.usageMetadata ?? {};

        return {
          rawText,
          tokensIn: Number(usage.promptTokenCount ?? 0),
          tokensOut: Number(usage.candidatesTokenCount ?? 0),
        };
      },
    };
  };
}

export type ClassifierAgentFactory = ReturnType<typeof createClassifierAgentFactory>;
