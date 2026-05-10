// POST-10: Uruguay (UY) source registry.
// Regulator: BCU (Banco Central del Uruguay).
// Fintech/remittance focus: BCU issues IMAEP licenses (Instituciones de
// Medios de Pago Electrónico) for e-money and remittance operators in Uruguay.
import type { SourceSpec } from '@regwatch/types/scanner';

/**
 * Hardcoded UY source registry. Order is stable for prompt determinism.
 * `as const satisfies readonly SourceSpec[]` enforces enum membership at compile time.
 */
export const UY_SOURCES = [
  {
    regulator: 'BCU_CIRCULARES',
    displayName: 'BCU Circulares (regulación financiera y de pagos)',
    searchUrl: 'https://www.bcu.gub.uy/Normativa-y-Legislacion/Paginas/Circulares.aspx',
    baseDomain: 'bcu.gub.uy',
  },
  {
    regulator: 'BCU_COMUNICACIONES',
    displayName: 'BCU Comunicaciones (resoluciones e instrucciones operativas)',
    searchUrl: 'https://www.bcu.gub.uy/Normativa-y-Legislacion/Paginas/Comunicaciones.aspx',
    baseDomain: 'bcu.gub.uy',
  },
] as const satisfies readonly SourceSpec[];

export type UySource = (typeof UY_SOURCES)[number];
