// MVP-13: Peru (PE) source registry.
// Regulator: SBS (Superintendencia de Banca, Seguros y AFP).
// Covers payment systems, empresas de pagos (EPs), and remittance operators.
import type { SourceSpec } from '@regwatch/types/scanner';

/**
 * Hardcoded PE source registry. Order is stable for prompt determinism.
 * `as const satisfies readonly SourceSpec[]` enforces enum membership at compile time.
 */
export const PE_SOURCES = [
  {
    regulator: 'SBS_RESOLUCIONES',
    displayName: 'SBS Resoluciones (banca y seguros)',
    searchUrl: 'https://www.sbs.gob.pe/regulacion/resoluciones-sbs',
    baseDomain: 'sbs.gob.pe',
  },
  {
    regulator: 'SBS_CIRCULARES',
    displayName: 'SBS Circulares (instrucciones operativas)',
    searchUrl: 'https://www.sbs.gob.pe/regulacion/circulares',
    baseDomain: 'sbs.gob.pe',
  },
] as const satisfies readonly SourceSpec[];

export type PeSource = (typeof PE_SOURCES)[number];
