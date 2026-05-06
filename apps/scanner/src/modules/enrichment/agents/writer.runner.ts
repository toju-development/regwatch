/**
 * Writer runner — pure function that drives the Writer agent call,
 * Zod-parses the response, applies the trust-boundary walker, and
 * validates citations against the source text.
 *
 * Spec: `sdd/classifier-and-writer/spec` R-2-Writer-Output-Contract,
 *   R-6-Trust-Boundary, R-7-Per-Alert-Failure-Isolation.
 * Design: `sdd/classifier-and-writer/design` ADR-1 (failure isolation),
 *   ADR-5 (citation contract — normalized substring, atomic reject),
 *   ADR-11 (trust boundary: Zod .strict() first, then assertNoForbiddenKeys).
 *
 * ERROR POLICY (R-7 / ADR-1):
 *   This function does NOT catch errors. Every throw bubbles up to the
 *   `EnrichmentService` per-alert try/catch chokepoint, which sets
 *   `enrichmentStatus=WRITE_FAILED`. Silencing errors here would mask
 *   schema regressions, trust-boundary violations, and citation failures.
 *
 * THREE-FENCE TRUST BOUNDARY (ADR-5, ADR-11):
 *   Fence 1 — `WriterOutputSchema.parse()`: Zod `.strict()` rejects unknown
 *     keys and validates field shapes (executiveSummary min length, etc.).
 *   Fence 2 — `assertNoForbiddenKeys()`: walker catches schema regressions that
 *     accidentally allow a forbidden key through a nested shape.
 *   Fence 3 — `validateCitations()`: every citation MUST be a normalized
 *     substring of `sourceText` (Alert.summary). Any miss → `WriterCitationError`.
 *   All fences MUST pass before any DB write.
 */
import { WriterOutputSchema, assertNoForbiddenKeys } from '@regwatch/types';
import type { WriterOutput } from '@regwatch/types';

import { validateCitations } from '../utils/citation.validator.js';
import type { OutputLanguage } from '../utils/language.helper.js';
import type { WriterAgent } from './writer.factory.js';

/** Forbidden keys that MUST never appear in LLM-derived output (ADR-11, R-6). */
const FORBIDDEN_KEYS = ['organizationId', 'userId', 'email'] as const;

/**
 * Thrown when one or more citations in the Writer output are NOT verbatim
 * substrings of the provided `sourceText` (Alert.summary).
 *
 * ADR-5: atomic reject — the entire Writer output is discarded on first miss.
 * Callers SHOULD persist `offending` in `Alert.enrichmentError` for auditability.
 */
export class WriterCitationError extends Error {
  /** The first citation that failed the substring check (normalized match). */
  readonly offending: string;

  constructor(offending: string) {
    super(
      `Writer citation not found in source text: "${offending.slice(0, 120)}${offending.length > 120 ? '…' : ''}"`,
    );
    this.name = 'WriterCitationError';
    this.offending = offending;
  }
}

/**
 * Run the Writer agent and return a validated `WriterOutput`.
 *
 * Steps (in order):
 *   1. Build prompt via `buildWriterPrompt` (inside agent.call).
 *   2. Call `agent.call(alert, language)` — raw Gemini response.
 *   3. JSON.parse the raw text.
 *   4. `WriterOutputSchema.parse(raw)` — strict Zod validation (fence 1).
 *   5. `assertNoForbiddenKeys(parsed, FORBIDDEN_KEYS)` — walker (fence 2).
 *   6. `validateCitations(output.citations, sourceText)` — citation check (fence 3).
 *      If `!valid` → throw `WriterCitationError` with `offending` field.
 *   7. Return `{ output, tokensIn, tokensOut }`.
 *
 * @param agent      - Writer agent from `createWriterAgentFactory`.
 * @param alert      - Alert metadata including `id` for error context (id not sent to LLM).
 * @param language   - Resolved output language (R-4).
 * @param sourceText - `Alert.summary` used exclusively for citation validation.
 *                     NEVER sent verbatim to the LLM as a prompt injection vector
 *                     beyond the factory's own prompt structure.
 *
 * @throws Zod `ZodError` on schema mismatch (field too short, extra key, etc.)
 * @throws `Error` from `assertNoForbiddenKeys` on forbidden key detection.
 * @throws `WriterCitationError` when a citation is not in `sourceText`.
 * @throws `SyntaxError` on invalid JSON from Gemini.
 */
export async function runWriter(
  agent: WriterAgent,
  alert: { id: string; title: string; summary: string; topic: string; severity: string },
  language: OutputLanguage,
  sourceText: string,
): Promise<{ output: WriterOutput; tokensIn: number; tokensOut: number }> {
  // Step 1+2: invoke Gemini (prompt built inside agent.call)
  const { rawText, tokensIn, tokensOut } = await agent.call(
    { title: alert.title, summary: alert.summary, topic: alert.topic, severity: alert.severity },
    language,
  );

  // Step 3: parse JSON (SyntaxError propagates to caller)
  const raw: unknown = JSON.parse(rawText);

  // Step 4: Zod strict parse — fence 1
  // WriterOutputSchema uses .strict() so unknown keys are rejected here.
  const output: WriterOutput = WriterOutputSchema.parse(raw);

  // Step 5: trust-boundary walker — fence 2
  // Guards against schema regressions that let forbidden keys through nested shapes.
  assertNoForbiddenKeys(output, FORBIDDEN_KEYS);

  // Step 6: citation validation — fence 3 (ADR-5)
  // Every citation must be a normalized substring of sourceText.
  // Atomic reject: any failure discards the entire Writer output.
  const { valid, offending } = validateCitations(output.citations, sourceText);
  if (!valid) {
    // offending is always set when valid=false (citation.validator contract)
    throw new WriterCitationError(offending!);
  }

  return { output, tokensIn, tokensOut };
}
