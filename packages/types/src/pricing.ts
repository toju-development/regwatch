/**
 * Pricing constants — single source of truth for cost arithmetic across
 * `apps/scanner` (cost helper, cap enforcement) and `apps/api` / `apps/web`
 * (usage widget cap display).
 *
 * Spec: `sdd/scanner-vertical-ar/spec` R-6-CostAccounting (rates), R-5
 *   /R-11 (monthly cap), INV-UT-1 (cap is a single source of truth).
 * Design: `sdd/scanner-vertical-ar/design` ADR-5 (rates), ADR-6 (cap).
 *
 * Numbers expressed in USD per 1M tokens. Cost computation MUST use
 * `Prisma.Decimal` end-to-end downstream — never JS `number` arithmetic.
 *
 * NOTE: Pure data + Zod-friendly. No `'server-only'`, no Node-only deps.
 */

/** Gemini 2.5 Flash published rates (locked: 2026-04 #722 Q3b). */
export const GEMINI_2_5_FLASH = {
  /** Input (prompt) tokens, USD per 1,000,000 tokens. */
  INPUT_USD_PER_1M: 0.3,
  /** Output (candidates) tokens, USD per 1,000,000 tokens. */
  OUTPUT_USD_PER_1M: 2.5,
} as const;

/**
 * Hard per-organization monthly spend cap, in USD. Hardcoded by BIZ-1.
 * Cap-enforcement (`UsageHelper.canScanThisMonth`) and UI widget both read
 * THIS constant — never duplicate the literal `10` elsewhere.
 */
export const MONTHLY_CAP_USD = 10 as const;
