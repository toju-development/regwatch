/**
 * Classifier runner — pure function that drives the Classifier agent call,
 * Zod-parses the response, and applies the trust-boundary walker.
 *
 * Spec: `sdd/classifier-and-writer/spec` R-1-Classifier-Output-Contract,
 *   R-6-Trust-Boundary, R-7-Per-Alert-Failure-Isolation.
 * Design: `sdd/classifier-and-writer/design` ADR-1 (two agents, failure isolation),
 *   ADR-11 (trust boundary: Zod .strict() first, then assertNoForbiddenKeys second).
 *
 * ERROR POLICY (R-7 / ADR-1):
 *   This function does NOT catch errors. Every throw bubbles up to the
 *   `EnrichmentService` per-alert try/catch chokepoint, which sets
 *   `enrichmentStatus=CLASSIFY_FAILED`. Silencing errors here would mask
 *   schema regressions and trust-boundary violations.
 *
 * TWO-FENCE TRUST BOUNDARY (ADR-11):
 *   Fence 1 — `ClassifierOutputSchema.parse()`: Zod `.strict()` rejects unknown
 *     keys at the schema boundary (e.g. extra fields Gemini snuck in).
 *   Fence 2 — `assertNoForbiddenKeys()`: walker catches schema regressions that
 *     accidentally allow a forbidden key through a nested shape.
 *   Both fences MUST run before any DB write.
 */
import { ClassifierOutputSchema, assertNoForbiddenKeys } from '@regwatch/types';
import type { AlertTopicValue, ClassifierOutput } from '@regwatch/types';

import type { ClassifierAgent } from './classifier.factory.js';
import type { OutputLanguage } from '../utils/language.helper.js';

/** Forbidden keys that MUST never appear in LLM-derived output (ADR-11, R-6). */
const FORBIDDEN_KEYS = ['organizationId', 'userId', 'email'] as const;

/**
 * Run the Classifier agent and return a validated `ClassifierOutput`.
 *
 * Steps (in order):
 *   1. Call `agent.call(alert, topics, language)` — raw Gemini response.
 *   2. JSON.parse the raw text.
 *   3. `ClassifierOutputSchema.parse(raw)` — strict Zod validation (fence 1).
 *   4. `assertNoForbiddenKeys(parsed, FORBIDDEN_KEYS)` — walker (fence 2).
 *   5. Return `{ output, tokensIn, tokensOut }`.
 *
 * @param agent    - Classifier agent from `createClassifierAgentFactory`.
 * @param alert    - Alert metadata including `id` for error context (id not sent to LLM).
 * @param topics   - AlertTopic values array (injected dynamically, never hardcoded).
 * @param language - Resolved output language.
 *
 * @throws Zod `ZodError` on schema mismatch (bad topic, out-of-range score, etc.)
 * @throws `Error` from `assertNoForbiddenKeys` on forbidden key detection.
 * @throws `SyntaxError` on invalid JSON from Gemini.
 */
export async function runClassifier(
  agent: ClassifierAgent,
  alert: { id: string; title: string; summary: string; sourceId: string },
  topics: AlertTopicValue[],
  language: OutputLanguage,
): Promise<{ output: ClassifierOutput; tokensIn: number; tokensOut: number }> {
  // Step 1: invoke Gemini
  const { rawText, tokensIn, tokensOut } = await agent.call(
    { title: alert.title, summary: alert.summary, sourceId: alert.sourceId },
    topics,
    language,
  );

  // Step 2: parse JSON (SyntaxError propagates to caller)
  const raw: unknown = JSON.parse(rawText);

  // Step 3: Zod strict parse — fence 1
  // ClassifierOutputSchema uses .strict() so unknown keys are rejected here.
  const output: ClassifierOutput = ClassifierOutputSchema.parse(raw);

  // Step 4: trust-boundary walker — fence 2
  // Guards against schema regressions that let forbidden keys through nested shapes.
  assertNoForbiddenKeys(output, FORBIDDEN_KEYS);

  return { output, tokensIn, tokensOut };
}
