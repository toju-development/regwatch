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

/** Resolve the source list for a given jurisdiction. MVP-5: AR only. */
export function sourcesFor(jurisdiction: string) {
  switch (jurisdiction) {
    case 'AR':
      return AR_SOURCES;
    default:
      throw new Error(
        `RootAgent: unsupported jurisdiction "${jurisdiction}" (MVP-5 ships AR only — MVP-13 adds BR/CO/PE/CL).`,
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
