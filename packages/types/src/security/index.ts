/**
 * Generic security walker: asserts that an object (or any nested value)
 * does NOT contain a set of forbidden keys.
 *
 * Promoted from `assertNoOrganizationId` in `apps/scanner` in MVP-6 (B1.2)
 * so both the Classifier and Writer agents can reuse the same trust-boundary
 * guard without a circular dependency.
 *
 * Spec: `sdd/classifier-and-writer/spec` R-6, INV-AE-1, ADR-11.
 *
 * SECURITY INVARIANT:
 *   Apply AFTER Zod parse, BEFORE any DB write.
 *   LLM-derived values for keys like `organizationId` are a tenant-isolation
 *   breach. This guard is the second fence after Zod `.strict()` strips
 *   unknown keys — it catches accidental schema regressions that let a
 *   forbidden key through a nested shape.
 */

/**
 * Build a regex that matches any key that looks like one of the given
 * forbidden names, regardless of case or separator style.
 *
 * Example: `organizationId` also matches `OrganizationId`, `organization_id`,
 * `organization-id`, `organizationID`, etc.
 *
 * Implementation: collapses any `[\s_-]` between word segments, lowercases
 * both sides before compare.
 */
function buildForbiddenKeyRegex(keys: readonly string[]): RegExp {
  // Normalise a candidate key: strip separators, lowercase.
  // We do this at match time, so the regex itself is a simple alternation.
  const patterns = keys.map((k) =>
    // Insert optional separator between every pair of adjacent characters
    // where a camelCase boundary COULD occur (between lower→upper).
    k.replace(/([a-z])([A-Z])/g, '$1[\\s_-]?$2').toLowerCase(),
  );
  return new RegExp(`^(?:${patterns.join('|')})$`, 'i');
}

/**
 * Recursively walk `value` and throw if any object key matches a forbidden
 * name (case-insensitive, ignoring `_`, `-`, space separators).
 *
 * @param value   - Any parsed value (object, array, primitive, null).
 * @param forbidden - List of logical key names to reject, e.g.
 *                    `['organizationId', 'userId', 'email']`.
 *
 * @throws `Error` on the FIRST forbidden key found, with path information.
 *
 * @example
 * ```ts
 * assertNoForbiddenKeys(classifierOutput, ['organizationId', 'userId', 'email']);
 * ```
 */
export function assertNoForbiddenKeys(value: unknown, forbidden: readonly string[]): void {
  if (forbidden.length === 0) return;

  const regex = buildForbiddenKeyRegex(forbidden);
  // Cycle guard — LLM JSON output won't have cycles but be defensive.
  const seen = new WeakSet<object>();

  const walk = (node: unknown, path: string): void => {
    if (node === null || node === undefined) return;
    if (typeof node !== 'object') return;
    if (seen.has(node as object)) return;
    seen.add(node as object);

    if (Array.isArray(node)) {
      node.forEach((item, idx) => walk(item, `${path}[${idx}]`));
      return;
    }

    for (const key of Object.keys(node as Record<string, unknown>)) {
      const fullKey = path ? `${path}.${key}` : key;
      if (regex.test(key)) {
        throw new Error(
          `assertNoForbiddenKeys: forbidden key "${key}" found at ${fullKey}. ` +
            `Forbidden keys: [${forbidden.join(', ')}]. ` +
            'LLM-derived tenant ids are a P0 security breach. ' +
            'Spec: sdd/classifier-and-writer/spec R-6, INV-AE-1.',
        );
      }
      walk((node as Record<string, unknown>)[key], fullKey);
    }
  };

  walk(value, '');
}
