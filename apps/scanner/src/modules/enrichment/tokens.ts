/**
 * NestJS DI tokens for `enrichment` module (MVP-6).
 *
 * Foot-gun #738 / #667: EVERY provider in `apps/scanner` MUST use explicit
 * `@Inject(TOKEN)`. Constructor-typed-class injection is UNRELIABLE under tsx
 * — Symbol tokens are the only safe path.
 *
 * Pattern: `Symbol.for(...)` keeps tokens stable across module reloads
 * (hot-reload, test isolation). `useExisting` pattern for `ENRICHMENT_SERVICE`
 * is required per ADR-10 to avoid double-instantiation foot-gun #738.
 *
 * Spec: `sdd/classifier-and-writer/spec` R-6 (trust boundary), ADR-10 (DI tokens).
 * Design: `sdd/classifier-and-writer/design` ADR-10.
 *
 * Token registration schedule:
 *   B3 — CLASSIFIER_AGENT_FACTORY
 *   B4 — WRITER_AGENT_FACTORY
 *   B5 — ENRICHMENT_SERVICE, ENRICHMENT_LISTENER
 *   B6 — wired into EnrichmentModule
 */

/** Classifier agent factory — `createClassifierAgentFactory(client)` result. */
export const CLASSIFIER_AGENT_FACTORY = Symbol.for('regwatch.enrichment.CLASSIFIER_AGENT_FACTORY');

/** Writer agent factory — `createWriterAgentFactory(client)` result. */
export const WRITER_AGENT_FACTORY = Symbol.for('regwatch.enrichment.WRITER_AGENT_FACTORY');

/**
 * EnrichmentService chokepoint.
 *
 * ADR-10: registered as class first, then `{ provide: ENRICHMENT_SERVICE,
 * useExisting: EnrichmentService }`. This token is what listeners inject.
 */
export const ENRICHMENT_SERVICE = Symbol.for('regwatch.enrichment.ENRICHMENT_SERVICE');

/** `resolveOutputLanguage` pure helper — injected for testability. */
export const LANGUAGE_RESOLVER = Symbol.for('regwatch.enrichment.LANGUAGE_RESOLVER');

/** `validateCitations` pure helper — injected for testability. */
export const CITATION_VALIDATOR = Symbol.for('regwatch.enrichment.CITATION_VALIDATOR');
