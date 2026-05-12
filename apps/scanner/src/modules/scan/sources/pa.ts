// POST-10b: Panama (PA) source registry.
// Regulator: Superintendencia de Bancos de Panamá (SBP).
// Fintech/remittance focus: SBP issues acuerdos (agreements/regulations)
// and resoluciones (resolutions) governing banking and payment operators in Panama.
import type { SourceSpec } from '@regwatch/types/scanner';

/**
 * Hardcoded PA source registry. Order is stable for prompt determinism.
 * `as const satisfies readonly SourceSpec[]` enforces enum membership at compile time.
 */
export const PA_SOURCES = [
  {
    regulator: 'SBP_ACUERDOS',
    displayName: 'Superintendencia de Bancos de Panamá — Acuerdos',
    searchUrl: 'https://www.superbancos.gob.pa/acuerdos/',
    baseDomain: 'superbancos.gob.pa',
  },
  {
    regulator: 'SBP_RESOLUCIONES',
    displayName: 'Superintendencia de Bancos de Panamá — Resoluciones',
    searchUrl: 'https://www.superbancos.gob.pa/resoluciones/',
    baseDomain: 'superbancos.gob.pa',
  },
] as const satisfies readonly SourceSpec[];

export type PaSource = (typeof PA_SOURCES)[number];
