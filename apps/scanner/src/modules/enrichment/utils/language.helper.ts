/**
 * Output-language resolver for the Writer agent.
 *
 * Spec: `sdd/classifier-and-writer/spec` R-4-Output-Language-Resolution.
 * Design: `sdd/classifier-and-writer/design` ADR-3 (universal factories,
 *   language as runtime parameter).
 *
 * Resolution order (R-4):
 *   1. `settingsOverride` (from `Settings.outputLanguage`) — explicit org preference
 *   2. Jurisdiction default (AR/CL/CO/PE → 'es', BR → 'pt')
 *   3. Global fallback: 'en'
 *
 * NOTE: Pure function. No NestJS deps, no side effects, no imports.
 */

/** Languages supported by the Writer agent. */
export type OutputLanguage = 'es' | 'en' | 'pt';

/** Jurisdiction-to-language defaults (R-4). */
const JURISDICTION_LANGUAGE: Record<string, OutputLanguage> = {
  AR: 'es',
  CL: 'es',
  CO: 'es',
  PE: 'es',
  BR: 'pt',
};

/**
 * Resolve the Writer output language for an org.
 *
 * @param jurisdiction     - ISO 3166-1 alpha-2 code (e.g. 'AR', 'BR'). Case-insensitive.
 * @param settingsOverride - Value of `Settings.outputLanguage`; null/undefined = no override.
 *
 * Priority: valid override > jurisdiction default > 'en' global fallback.
 * Invalid overrides (e.g. 'fr') are silently ignored and fall through to
 * jurisdiction default, never crash.
 */
export function resolveOutputLanguage(
  jurisdiction: string,
  settingsOverride: string | null | undefined,
): OutputLanguage {
  if (settingsOverride === 'es' || settingsOverride === 'en' || settingsOverride === 'pt') {
    return settingsOverride;
  }
  return JURISDICTION_LANGUAGE[jurisdiction.toUpperCase()] ?? 'en';
}
