// MVP-13: Brazil (BR) source registry.
// Regulators: BCB (Banco Central do Brasil) + CVM (Comissão de Valores Mobiliários).
// Fintech/remittance focus: BCB covers payment systems (IPs, SCDs, SEPs),
// CVM covers capital markets instruments relevant to cross-border transactions.
import type { SourceSpec } from '@regwatch/types/scanner';

/**
 * Hardcoded BR source registry. Order is stable for prompt determinism.
 * `as const satisfies readonly SourceSpec[]` enforces enum membership at compile time.
 */
export const BR_SOURCES = [
  {
    regulator: 'BCB_CIRCULARES',
    displayName: 'BCB Circulares (normas ao sistema financeiro)',
    searchUrl: 'https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo',
    baseDomain: 'bcb.gov.br',
  },
  {
    regulator: 'BCB_RESOLUCOES',
    displayName: 'BCB Resoluções (atos normativos CMN/BCB)',
    searchUrl: 'https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo',
    baseDomain: 'bcb.gov.br',
  },
  {
    regulator: 'CVM_RESOLUCOES',
    displayName: 'CVM Resoluções (mercado de capitais)',
    searchUrl: 'https://conteudo.cvm.gov.br/legislacao/resolucoes/index.html',
    baseDomain: 'cvm.gov.br',
  },
] as const satisfies readonly SourceSpec[];

export type BrSource = (typeof BR_SOURCES)[number];
