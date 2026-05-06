/**
 * Citation validator for Writer agent output.
 *
 * Spec: `sdd/classifier-and-writer/spec` R-2-Writer-Output-Contract, ADR-5.
 * Design: `sdd/classifier-and-writer/design` ADR-5 (citation contract —
 *   normalized substring, atomic reject).
 *
 * Contract (ADR-5):
 *   Every citation MUST be a substring of `sourceText` after normalizing
 *   both sides (collapse whitespace → single space, lowercase, trim).
 *   The first invalid citation stops validation and is returned as `offending`.
 *   On any failure, the ENTIRE Writer output is rejected — NO partial accept.
 *   Empty citations array is always valid.
 *
 * NOTE: Pure function. No imports, no side effects, no NestJS deps.
 */

/** Normalize a string: collapse whitespace, trim, lowercase. */
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface CitationValidationResult {
  /** `true` if all citations are valid substrings of `sourceText`. */
  valid: boolean;
  /**
   * The first citation that failed the substring check, or `null` when valid.
   * Callers SHOULD include this in `Alert.enrichmentError` for auditability.
   */
  offending: string | null;
}

/**
 * Validate that every citation is a verbatim (normalized) substring of sourceText.
 *
 * @param citations  - Array of citation strings from Writer output.
 * @param sourceText - The `Alert.summary` text to check against.
 *
 * @returns `{ valid: true, offending: null }` if all pass, or
 *          `{ valid: false, offending: <first failing citation> }` on first miss.
 */
export function validateCitations(
  citations: string[],
  sourceText: string,
): CitationValidationResult {
  if (citations.length === 0) {
    return { valid: true, offending: null };
  }

  const normalizedSource = normalize(sourceText);

  for (const citation of citations) {
    if (!normalizedSource.includes(normalize(citation))) {
      return { valid: false, offending: citation };
    }
  }

  return { valid: true, offending: null };
}
