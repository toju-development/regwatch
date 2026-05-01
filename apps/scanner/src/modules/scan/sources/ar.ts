// MVP-5: AR-only sources. Other countries (BR/CO/PE/CL) → MVP-13 scanners-br-co-pe-cl.
// Move to DB Source table when MVP-13 lands.
//
// DEPRECATED-IN-MVP-13: migrate to RegulatorySource DB table — `JurisdictionScannerFactory`
// signature stays unchanged (factory takes `readonly SourceSpec[]`).
//
// Spec: sdd/scanner-vertical-ar/spec R-2-Sources (4 entries, deprecation marker).
// Design: sdd/scanner-vertical-ar/design ADR-7 (4-value enum), ADR-8 (sources/ar.ts shape).
import type { SourceSpec } from '@regwatch/types/scanner';

/**
 * Hardcoded AR source registry. Order is stable for prompt determinism.
 * `as const satisfies readonly SourceSpec[]` enforces enum membership at compile time.
 */
export const AR_SOURCES = [
  {
    regulator: 'BCRA_COMUNICADOS_A',
    displayName: 'BCRA Comunicaciones "A" (entidades financieras — normativas)',
    searchUrl: 'https://www.bcra.gob.ar/SistemasFinancierosYdePagos/Comunicaciones_buscador.asp',
    baseDomain: 'bcra.gob.ar',
  },
  {
    regulator: 'BCRA_COMUNICADOS_B',
    displayName: 'BCRA Comunicaciones "B" (informativas)',
    searchUrl: 'https://www.bcra.gob.ar/SistemasFinancierosYdePagos/Comunicaciones_buscador.asp',
    baseDomain: 'bcra.gob.ar',
  },
  {
    regulator: 'BCRA_COMUNICADOS_C',
    displayName: 'BCRA Comunicaciones "C" (administrativas)',
    searchUrl: 'https://www.bcra.gob.ar/SistemasFinancierosYdePagos/Comunicaciones_buscador.asp',
    baseDomain: 'bcra.gob.ar',
  },
  {
    regulator: 'CNV_RESOLUCIONES_GENERALES',
    displayName: 'CNV Resoluciones Generales (mercado de capitales)',
    searchUrl: 'https://www.cnv.gov.ar/sitiocnv/ResolucionesGenerales',
    baseDomain: 'cnv.gov.ar',
  },
] as const satisfies readonly SourceSpec[];

export type ArSource = (typeof AR_SOURCES)[number];
