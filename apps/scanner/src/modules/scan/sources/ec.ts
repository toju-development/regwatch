// POST-10b: Ecuador (EC) source registry.
// Regulator: Superintendencia de Bancos del Ecuador (SB_EC).
// Fintech/remittance focus: SB_EC oversees banking institutions and issues
// resoluciones (binding regulations) and circulares (operational instructions).
import type { SourceSpec } from '@regwatch/types/scanner';

/**
 * Hardcoded EC source registry. Order is stable for prompt determinism.
 * `as const satisfies readonly SourceSpec[]` enforces enum membership at compile time.
 */
export const EC_SOURCES = [
  {
    regulator: 'SB_EC_RESOLUCIONES',
    displayName: 'Superintendencia de Bancos del Ecuador — Resoluciones',
    searchUrl: 'https://www.superbancos.gob.ec/bancos/resoluciones/',
    baseDomain: 'superbancos.gob.ec',
  },
  {
    regulator: 'SB_EC_CIRCULARES',
    displayName: 'Superintendencia de Bancos del Ecuador — Circulares',
    searchUrl: 'https://www.superbancos.gob.ec/bancos/circulares/',
    baseDomain: 'superbancos.gob.ec',
  },
] as const satisfies readonly SourceSpec[];

export type EcSource = (typeof EC_SOURCES)[number];
