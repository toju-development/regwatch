// MVP-13: Chile (CL) source registry.
// Regulator: CMF (Comisión para el Mercado Financiero).
// Covers payment entities and fintechs under Ley Fintech 2023 (Ley 21.521).
import type { SourceSpec } from '@regwatch/types/scanner';

/**
 * Hardcoded CL source registry. Order is stable for prompt determinism.
 * `as const satisfies readonly SourceSpec[]` enforces enum membership at compile time.
 */
export const CL_SOURCES = [
  {
    regulator: 'CMF_NORMAS',
    displayName: 'CMF Normas (valores y seguros)',
    searchUrl: 'https://www.cmfchile.cl/portal/regulacion/669/w3-propertyname-2365.html',
    baseDomain: 'cmfchile.cl',
  },
  {
    regulator: 'CMF_RESOLUCIONES',
    displayName: 'CMF Resoluciones (actos administrativos)',
    searchUrl: 'https://www.cmfchile.cl/portal/regulacion/669/w3-propertyname-2364.html',
    baseDomain: 'cmfchile.cl',
  },
] as const satisfies readonly SourceSpec[];

export type ClSource = (typeof CL_SOURCES)[number];
