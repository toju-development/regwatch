/**
 * Jurisdictions registry — single source of truth for the LatAm seed.
 *
 * Spec: `sdd/jurisdictions-config/spec` R-Settings-Schema.
 * Design: `sdd/jurisdictions-config/design` §0 D4–D5 (const-array authoring
 * shape, 7 LatAm members) and §5 (canonical export shape).
 *
 * INVARIANTS:
 * - Pure data, NO `'server-only'` import — must be importable from
 *   `apps/web` (RSC + client + edge), `apps/api`, `apps/scanner`,
 *   tests and Playwright. Mirrors the `computeInvitationStatus`
 *   posture (cf. capability/db-schema #637 footgun 6).
 * - Adding a country = ONE line in {@link JURISDICTIONS}. The Zod enum,
 *   literal-union TS type, and `Record<code,Jurisdiction>` lookup are all
 *   derived — no schema migration required (per design D5 / D14).
 * - Codes are uppercase ISO 3166-1 alpha-2.
 */
import { z } from 'zod';

export interface Jurisdiction {
  /** ISO 3166-1 alpha-2 country code (uppercase). */
  readonly code: string;
  /** Human-readable display name (Spanish/Portuguese as used in-product). */
  readonly name: string;
  /** Continental grouping. Currently only `LATAM`. */
  readonly region: 'LATAM';
}

/**
 * The full registry. Order is presentation order (no business meaning).
 * Per design D5: locked at 7 LatAm members for MVP-4.
 */
export const JURISDICTIONS = [
  { code: 'MX', name: 'México', region: 'LATAM' },
  { code: 'CO', name: 'Colombia', region: 'LATAM' },
  { code: 'PE', name: 'Perú', region: 'LATAM' },
  { code: 'CL', name: 'Chile', region: 'LATAM' },
  { code: 'AR', name: 'Argentina', region: 'LATAM' },
  { code: 'UY', name: 'Uruguay', region: 'LATAM' },
  { code: 'BR', name: 'Brasil', region: 'LATAM' },
] as const satisfies readonly Jurisdiction[];

/** Authoring-shape literal union, derived from {@link JURISDICTIONS}. */
export type JurisdictionCode = (typeof JURISDICTIONS)[number]['code'];

/**
 * Tuple of code literals. Const-asserted so `z.enum` can derive the schema
 * with full literal-union typing.
 */
export const JURISDICTION_CODES = JURISDICTIONS.map((j) => j.code) as readonly JurisdictionCode[];

/**
 * Zod enum for runtime validation of an arbitrary string against the
 * registry. Used by `SettingsJurisdictionSchema` and the API's
 * `ZodBodyPipe` on `PUT /org/:orgId/settings`.
 */
export const JurisdictionCodeSchema = z.enum(
  JURISDICTION_CODES as unknown as readonly [JurisdictionCode, ...JurisdictionCode[]],
);

/**
 * Frozen O(1) lookup `code → Jurisdiction`. Computed once at module load.
 * Use this anywhere you have a code and need its display name / region.
 */
export const JURISDICTIONS_BY_CODE: Readonly<Record<JurisdictionCode, Jurisdiction>> =
  Object.freeze(
    Object.fromEntries(JURISDICTIONS.map((j) => [j.code, j])) as Record<
      JurisdictionCode,
      Jurisdiction
    >,
  );
