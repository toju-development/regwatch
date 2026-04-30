/**
 * MVP-5 NestJS DI tokens for `apps/scanner`.
 *
 * Foot-gun #667 (tsx + NestJS DI): EVERY provider/controller in `apps/scanner`
 * MUST use explicit `@Inject(TOKEN)`. Constructor-typed-class injection is
 * UNRELIABLE under tsx — symbols/string tokens are the only safe path.
 *
 * Skeleton placeholder. Tokens are populated as their owning modules land:
 *   B2 — env/config wiring
 *   B3 — SCAN_SERVICE, GEMINI_CLIENT, ROOT_AGENT_FACTORY,
 *        JURISDICTION_SCANNER_FACTORY, DEDUP_HELPER
 *   B4 — USAGE_HELPER, COST_HELPER
 *   B5 — (cron + controller use the above)
 *
 * Spec: `sdd/scanner-vertical-ar/spec` (no direct requirement; consumed by
 *   R-1, R-3, R-5, R-7, R-8 implementations).
 * Design: `sdd/scanner-vertical-ar/design` ADR-15.
 */
export {};
