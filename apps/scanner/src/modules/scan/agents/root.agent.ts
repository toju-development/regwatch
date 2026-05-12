/**
 * RootAgent — orchestrates per-jurisdiction `JurisdictionScanner` invocations
 * for one scan run. MVP-5 only knows about AR.
 *
 * Spec: sdd/scanner-vertical-ar/spec R-1-AdkTopology (Root delegates to factory).
 * Design: sdd/scanner-vertical-ar/design ADR-2 (RootAgent persona).
 *
 * Returned shape stays deliberately thin — `ScanService` is the chokepoint that
 * dedups, persists, and emits events (R-3, INV-SP-1/2). The agent surface
 * NEVER touches `organizationId`.
 */
import { AR_SOURCES } from '../sources/ar.js';
import { BR_SOURCES } from '../sources/br.js';
import { CL_SOURCES } from '../sources/cl.js';
import { CO_SOURCES } from '../sources/co.js';
import { EC_SOURCES } from '../sources/ec.js';
import { MX_SOURCES } from '../sources/mx.js';
import { PA_SOURCES } from '../sources/pa.js';
import { PE_SOURCES } from '../sources/pe.js';
import { UY_SOURCES } from '../sources/uy.js';
import {
  type AgentUsageMetadata,
  type JurisdictionScanner,
  type JurisdictionScannerFactory,
} from './jurisdiction-scanner.factory.js';
import type { Finding } from './finding.schema.js';

export interface RootAgentRunOpts {
  jurisdiction: string;
  sinceDate?: Date;
  customTopics?: string;
}

export interface RootAgentRunResult {
  jurisdiction: string;
  findings: Finding[];
  usageMetadata: AgentUsageMetadata;
}

export interface RootAgent {
  run(opts: RootAgentRunOpts): Promise<RootAgentRunResult>;
}

/** Resolve the source list for a given jurisdiction. */
export function sourcesFor(jurisdiction: string) {
  switch (jurisdiction) {
    case 'AR':
      return AR_SOURCES;
    case 'BR':
      return BR_SOURCES;
    case 'CO':
      return CO_SOURCES;
    case 'PE':
      return PE_SOURCES;
    case 'CL':
      return CL_SOURCES;
    case 'MX':
      return MX_SOURCES;
    case 'UY':
      return UY_SOURCES;
    case 'EC':
      return EC_SOURCES;
    case 'PA':
      return PA_SOURCES;
    default:
      throw new Error(
        `RootAgent: unsupported jurisdiction "${jurisdiction}" — supported: AR, BR, CO, PE, CL, MX, UY, EC, PA.`,
      );
  }
}

/**
 * Build a RootAgent backed by a JurisdictionScannerFactory. Stateless — safe to
 * memoize at module scope.
 */
export function createRootAgent(factory: JurisdictionScannerFactory): RootAgent {
  return {
    async run({ jurisdiction, sinceDate, customTopics }) {
      const scanner: JurisdictionScanner = factory({
        jurisdiction,
        sources: sourcesFor(jurisdiction),
      });
      const { findings, usageMetadata } = await scanner.run({
        ...(sinceDate !== undefined ? { sinceDate } : {}),
        ...(customTopics !== undefined ? { customTopics } : {}),
      });
      return { jurisdiction, findings, usageMetadata };
    },
  };
}
