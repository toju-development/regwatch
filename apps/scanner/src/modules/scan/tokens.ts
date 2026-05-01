/**
 * MVP-5 NestJS DI tokens for `apps/scanner`.
 *
 * Foot-gun #667 (tsx + NestJS DI): EVERY provider/controller in `apps/scanner`
 * MUST use explicit `@Inject(TOKEN)`. Constructor-typed-class injection is
 * UNRELIABLE under tsx — symbols/string tokens are the only safe path.
 *
 * Canonical token set per design `sdd/scanner-vertical-ar/design` ADR-15.
 * Tokens are declared up-front (compile-time stable); their providers are
 * registered as their owning modules land:
 *   B3 — SCAN_SERVICE, GEMINI_CLIENT, ROOT_AGENT_FACTORY,
 *        JURISDICTION_SCANNER_FACTORY, DEDUP_HELPER
 *   B4 — USAGE_HELPER, COST_HELPER
 *   B5 — (cron + controller bind to the above)
 *
 * Spec: `sdd/scanner-vertical-ar/spec` (consumed by R-1, R-3, R-5, R-7, R-8).
 */

/** Chokepoint orchestrator — `runScan(orgId)` (R-3, R-4, R-8). */
export const SCAN_SERVICE = Symbol.for('regwatch.scanner.SCAN_SERVICE');

/** Monthly cap aggregator (`packages/db/src/usage.ts`) — R-5, R-11. */
export const USAGE_HELPER = Symbol.for('regwatch.scanner.USAGE_HELPER');

/** Gemini SDK client (Generative AI / ADK provider) — R-1. */
export const GEMINI_CLIENT = Symbol.for('regwatch.scanner.GEMINI_CLIENT');

/** Token cost → `Prisma.Decimal` translator — R-6, R-14. */
export const COST_HELPER = Symbol.for('regwatch.scanner.COST_HELPER');

/** URL normalize + sha256 + optimistic-insert dedup — R-4, INV-SP-2. */
export const DEDUP_HELPER = Symbol.for('regwatch.scanner.DEDUP_HELPER');

/** ADK Root LlmAgent factory — R-1, R-3 (LLM-injection defense). */
export const ROOT_AGENT_FACTORY = Symbol.for('regwatch.scanner.ROOT_AGENT_FACTORY');

/** Per-jurisdiction `ScannerXX LlmAgent` builder — R-1, R-2 (4 AR sources). */
export const JURISDICTION_SCANNER_FACTORY = Symbol.for(
  'regwatch.scanner.JURISDICTION_SCANNER_FACTORY',
);
