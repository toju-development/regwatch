// POST-10: Mexico (MX) source registry.
// Regulators: CNBV (Comisión Nacional Bancaria y de Valores) + BANXICO (Banco de México).
// Fintech/remittance focus: CNBV covers fintech licensing + banking regulation;
// BANXICO covers payment systems (SPEI, CoDi) and remittance corridors.
import type { SourceSpec } from '@regwatch/types/scanner';

/**
 * Hardcoded MX source registry. Order is stable for prompt determinism.
 * `as const satisfies readonly SourceSpec[]` enforces enum membership at compile time.
 */
export const MX_SOURCES = [
  {
    regulator: 'CNBV_CIRCULARES',
    displayName: 'CNBV Circulares (instituciones financieras)',
    searchUrl: 'https://www.gob.mx/cnbv/documentos/circulares-de-bancos',
    baseDomain: 'gob.mx',
  },
  {
    regulator: 'CNBV_RESOLUCIONES',
    displayName: 'CNBV Resoluciones Modificatorias (regulación fintech)',
    searchUrl: 'https://www.gob.mx/cnbv/documentos/resoluciones-modificatorias',
    baseDomain: 'gob.mx',
  },
  {
    regulator: 'BANXICO_CIRCULARES',
    displayName: 'BANXICO Circulares (sistemas de pago y remesas)',
    searchUrl: 'https://www.banxico.org.mx/marco-normativo/',
    baseDomain: 'banxico.org.mx',
  },
] as const satisfies readonly SourceSpec[];

export type MxSource = (typeof MX_SOURCES)[number];
