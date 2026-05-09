/**
 * Scanner domain Zod schemas — contract between Gemini LLM output and
 * the trusted `ScanService.runScan` chokepoint.
 *
 * Spec: `sdd/scanner-vertical-ar/spec` R-1-AdkTopology (responseSchema),
 *   R-2-Sources (registry shape), R-3-ScanServiceChokepoint (no
 *   `organizationId` in agent output — trust boundary), R-4-Dedup.
 * Design: `sdd/scanner-vertical-ar/design` ADR-2 (ADK topology), ADR-7
 *   (4-value AlertSource enum reconciliation), ADR-8 (sources/ar.ts shape),
 *   ADR-15 (chokepoint trust).
 *
 * SECURITY INVARIANT (R-3 / INV-SP-2):
 *   `FindingSchema` MUST NEVER contain `organizationId`. The trusted `orgId`
 *   parameter to `ScanService.runScan` is the only authority. LLM output is
 *   untrusted text; persisting an LLM-derived org id is an injection vector.
 *
 * NOTE: Pure data + Zod. No `'server-only'`, no Node-only deps.
 */
import { z } from 'zod';

/**
 * Canonical AR source registry enum — mirrored 1:1 in Postgres `AlertSource`
 * enum (see `packages/db/prisma/schema.prisma`).
 *
 * Reconciliation (design ADR-7 + ADR-17): proposal/exploration listed only
 * `BCRA_COMUNICADOS` + `CNV_RESOLUCIONES`, but design expanded to 4 entries
 * (BCRA Comunicados A/B/C as separate sub-feeds + CNV Resoluciones Generales)
 * since each BCRA letter has a distinct URL, audience, and cadence.
 *
 * MVP-13 will append `CNBV_MX_*`, `SBS_PE_*`, `BR_BCB_*`, `CL_CMF_*` (Postgres
 * enum extension is cheap; values are append-only).
 */
export const AlertSourceSchema = z.enum([
  // AR — Argentina (MVP-5)
  'BCRA_COMUNICADOS_A',
  'BCRA_COMUNICADOS_B',
  'BCRA_COMUNICADOS_C',
  'CNV_RESOLUCIONES_GENERALES',
  // MVP-7 manual ingestion (sdd/manual-ingestion R-SCHEMA-1)
  'MANUAL',
  // BR — Brazil (MVP-13)
  'BCB_CIRCULARES',
  'BCB_RESOLUCOES',
  'CVM_RESOLUCOES',
  // CO — Colombia (MVP-13)
  'SFC_CIRCULARES_EXTERNAS',
  // PE — Peru (MVP-13)
  'SBS_RESOLUCIONES',
  'SBS_CIRCULARES',
  // CL — Chile (MVP-13)
  'CMF_NORMAS',
  'CMF_RESOLUCIONES',
]);
export type AlertSource = z.infer<typeof AlertSourceSchema>;

/**
 * Single regulator finding produced by the per-jurisdiction LLM agent.
 *
 * SECURITY: This shape DELIBERATELY OMITS `organizationId`. See file header.
 */
export const FindingSchema = z.object({
  source: AlertSourceSchema,
  sourceUrl: z.url(),
  title: z.string().min(3).max(500),
  summary: z.string().max(2000),
  /** Optional — many regulators don't expose a stable publication date. */
  publishedAt: z.iso.datetime().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

/**
 * Top-level Gemini structured-output envelope. `responseSchema` is derived
 * from this shape (see `JurisdictionScannerFactory`). Capped at 50 findings
 * per scan to bound LLM output size + downstream insert loop.
 */
export const ScanResultSchema = z.object({
  findings: z.array(FindingSchema).max(50),
});
export type ScanResult = z.infer<typeof ScanResultSchema>;

/**
 * Static spec for one regulator/source feed (`apps/scanner/.../sources/ar.ts`).
 *
 * Marked `as const satisfies readonly SourceSpec[]` at the call site so TS
 * verifies `regulator` literals against `AlertSourceSchema` enum.
 */
export type SourceSpec = {
  regulator: AlertSource;
  /** Human-readable label used in logs + future UI. */
  displayName: string;
  /** Seed URL handed to the LLM as a starting grounding hint. */
  searchUrl: string;
  /** Bare host used to constrain `googleSearch` results when prompted. */
  baseDomain: string;
};
