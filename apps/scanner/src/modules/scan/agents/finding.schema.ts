/**
 * Re-export of `FindingSchema` / `ScanResultSchema` for the agents subfolder.
 *
 * SECURITY INVARIANT (R-3 / INV-SP-2):
 *   `FindingSchema` MUST NEVER contain `organizationId`. The trusted `orgId`
 *   parameter to `ScanService.runScan` is the only authority. LLM agent output
 *   is untrusted text; an LLM-derived org id is a tenant-isolation breach.
 *
 *   This file additionally exports a `assertNoOrganizationId` runtime guard
 *   used by the chokepoint to harden against accidental schema regressions
 *   (defense-in-depth — see scan.service.ts).
 *
 * Spec: sdd/scanner-vertical-ar/spec R-1-AdkTopology, R-3-ScanServiceChokepoint.
 * Design: sdd/scanner-vertical-ar/design ADR-2, ADR-15.
 */
export {
  AlertSourceSchema,
  FindingSchema,
  ScanResultSchema,
  type AlertSource,
  type Finding,
  type ScanResult,
  type SourceSpec,
} from '@regwatch/types/scanner';

import { FindingSchema } from '@regwatch/types/scanner';

/**
 * Compile-time + runtime assertion that `FindingSchema` does NOT declare an
 * `organizationId` shape key. Used by `finding.schema.spec.ts` (R-3 invariant).
 */
export function findingSchemaShapeKeys(): readonly string[] {
  return Object.keys(FindingSchema.shape);
}

/**
 * Match any key that looks like an org id, regardless of casing or
 * separator. Catches `organizationId`, `OrganizationId`, `organization_id`,
 * `organization-id`, `organizationID`, etc.
 */
const ORG_ID_KEY_REGEX = /^organization[\s_-]?id$/i;

/**
 * Defense-in-depth runtime guard: throws if `obj` (or ANY nested object/
 * array element) carries a key that looks like an organization id.
 *
 * Rationale:
 *   `FindingSchema` already strips unknown keys at parse time, so a
 *   well-formed Zod-parsed `Finding` cannot carry `organizationId`. This
 *   guard is the SECOND fence — invoked at the `ScanService` chokepoint
 *   right before the trusted `organizationId` is stamped onto the row.
 *   It catches:
 *     1. Schema regressions that accidentally allow the field through.
 *     2. Code paths that bypass `FindingSchema.parse` and persist raw LLM
 *        output (a future bug we want to fail LOUDLY, not silently).
 *
 * Throws a synchronous `Error` — callers MUST treat this as a P0 tenant-
 * isolation breach and abort the persist.
 *
 * Spec: sdd/scanner-vertical-ar/spec R-3-ScanServiceChokepoint, INV-SP-2.
 * Design: sdd/scanner-vertical-ar/design ADR-2, ADR-15.
 */
export function assertNoOrganizationId(obj: unknown): void {
  // Guard against cycles in pathological input (LLM output is JSON, so
  // cycles are not expected, but be defensive — an Error is better than
  // a stack overflow).
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
      if (ORG_ID_KEY_REGEX.test(key)) {
        throw new Error(
          `assertNoOrganizationId: forbidden key "${key}" found at ${path || '<root>'}. ` +
            'LLM-derived organization ids are a P0 tenant-isolation breach. ' +
            'Spec: sdd/scanner-vertical-ar/spec R-3, INV-SP-2.',
        );
      }
      walk((node as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
    }
  };

  walk(obj, '');
}
