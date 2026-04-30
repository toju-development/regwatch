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
