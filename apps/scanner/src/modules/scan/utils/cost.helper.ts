/**
 * Token-cost translator: Gemini `usageMetadata` → `Prisma.Decimal` USD cost.
 *
 * Spec: `sdd/scanner-vertical-ar/spec` R-6-CostAccounting, R-14 (Decimal
 *   precision), INV-SP-3 (`Prisma.Decimal` end-to-end — NEVER JS `number`).
 * Design: `sdd/scanner-vertical-ar/design` ADR-5 (rates + flow).
 *
 * Pricing constants are LOCAL to this helper (not from `@regwatch/types/pricing`)
 * because the orchestrator brief locked the MVP-5 rates explicitly to avoid a
 * silent drift if the published `GEMINI_2_5_FLASH` rates are ever updated upstream
 * before billing-stripe lands. The current values match
 * `@regwatch/types/pricing.GEMINI_2_5_FLASH` (input $0.30/1M, output $2.50/1M).
 *
 * MVP-5: prices locked Apr 2026. Move to packages/config when MVP-13 multi-model.
 *   Re-verify quarterly against https://ai.google.dev/pricing.
 *
 * INV-SP-3 invariant enforcement: every arithmetic step uses `Prisma.Decimal`.
 *   `tokens × rate / 1e6` runs as `Decimal(tokens).mul(Decimal(rate)).div(1e6)`,
 *   never `(tokens * rate) / 1e6` on raw `number`s. Token counts ARE integers
 *   so wrapping them as `Decimal` from the start is safe and explicit.
 *
 * Cost-of-grounding note: `googleSearch` tool calls are FREE under MVP-5
 *   quota (per ADR-5). Not added to `costUsd`. Track as risk for billing-stripe.
 */
import { Prisma } from '@regwatch/db/client';

/** Gemini 2.5 Flash input rate, USD per 1M prompt tokens (Apr 2026). */
const INPUT_USD_PER_1M = new Prisma.Decimal('0.30');

/** Gemini 2.5 Flash output rate, USD per 1M candidate tokens (Apr 2026). */
const OUTPUT_USD_PER_1M = new Prisma.Decimal('2.50');

/** Divisor for the per-1M rate (1,000,000). */
const PER_MILLION = new Prisma.Decimal('1000000');

/**
 * Subset of Gemini's `response.usageMetadata` we care about. Both fields
 * default to 0 if upstream omits them — defensive coding because Gemini
 * occasionally returns `undefined` candidatesTokenCount on empty completions.
 */
export interface GeminiUsageMetadata {
  promptTokenCount?: number | null | undefined;
  candidatesTokenCount?: number | null | undefined;
  /** Optional pre-computed sum from Gemini. We re-derive defensively. */
  totalTokenCount?: number | null | undefined;
}

export interface ComputedCost {
  /** Sum of input + output token counts (denormalized for fast SUM in DB). */
  tokensUsed: number;
  /** USD cost as `Prisma.Decimal`. NEVER converted to JS `number`. */
  costUsd: Prisma.Decimal;
}

/**
 * Compute the USD cost of one Gemini call from `response.usageMetadata`.
 *
 * Math (all in `Prisma.Decimal`):
 *   costUsd = (promptTokens × INPUT_USD_PER_1M + candidatesTokens × OUTPUT_USD_PER_1M) / 1e6
 *
 * Returns `tokensUsed` separately so the caller can persist the denormalized
 * sum into `ScanLog.tokensUsed` without re-computing.
 */
export function computeCostFromUsageMetadata(usage: GeminiUsageMetadata): ComputedCost {
  // Coerce nullish/undefined token counts to 0. Negative counts are invalid
  // (Gemini never emits them) but clamp to 0 just in case to avoid negative
  // billing on an upstream bug.
  const promptTokens = Math.max(0, Math.trunc(usage.promptTokenCount ?? 0));
  const candidatesTokens = Math.max(0, Math.trunc(usage.candidatesTokenCount ?? 0));

  const inputCost = new Prisma.Decimal(promptTokens).mul(INPUT_USD_PER_1M).div(PER_MILLION);
  const outputCost = new Prisma.Decimal(candidatesTokens).mul(OUTPUT_USD_PER_1M).div(PER_MILLION);
  const costUsd = inputCost.plus(outputCost);

  return {
    tokensUsed: promptTokens + candidatesTokens,
    costUsd,
  };
}
