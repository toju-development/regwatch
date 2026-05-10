// MVP-13: Colombia (CO) source registry.
// Regulator: SFC (Superintendencia Financiera de Colombia).
// Covers fintech, payment entities, and remittance operators under prudential + conduct framework.
import type { SourceSpec } from '@regwatch/types/scanner';

/**
 * Hardcoded CO source registry. Order is stable for prompt determinism.
 * `as const satisfies readonly SourceSpec[]` enforces enum membership at compile time.
 */
export const CO_SOURCES = [
  {
    regulator: 'SFC_CIRCULARES_EXTERNAS',
    displayName: 'SFC Circulares Externas (sector financiero)',
    searchUrl:
      'https://www.superfinanciera.gov.co/inicio/normativa/normativa-general/circulares-externas-60736',
    baseDomain: 'superfinanciera.gov.co',
  },
] as const satisfies readonly SourceSpec[];

export type CoSource = (typeof CO_SOURCES)[number];
