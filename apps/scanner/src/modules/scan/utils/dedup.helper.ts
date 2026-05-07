/**
 * URL normalization + sha256 hashing + in-memory dedup helpers for `ScanService`.
 *
 * Spec: sdd/scanner-vertical-ar/spec R-4-Dedup (URL normalization, cross-org).
 * Design: sdd/scanner-vertical-ar/design ADR-9 (normalization rules + sha256 hex).
 *
 * B2.5 (manual-ingestion MVP-7): `normalizeUrl` and `computeSourceUrlHash` are
 * now the canonical implementations from `@regwatch/db/dedup` (ADR-6 single
 * source of truth). Re-exported here for backwards compatibility with existing
 * callers in this module.
 *
 * Deterministic helper — NEVER exposed as an LLM agent tool (ADR-2: persistence
 * stays out of the agent surface, no LLM-driven `organizationId`).
 */
import { normalizeUrl, computeSourceUrlHash } from '@regwatch/db/dedup';
import type { Finding } from '@regwatch/types/scanner';

export { normalizeUrl, computeSourceUrlHash };

/**
 * In-memory dedup pass before the DB write loop. Keeps the FIRST occurrence of
 * each `sourceUrlHash`. The DB `@@unique([organizationId, sourceUrlHash])`
 * remains the authoritative gate (cross-process race-safe).
 *
 * Hashes the NORMALIZED form of each URL (via `normalizeUrl`) so that cosmetic
 * variants collapse to the same slot.
 */
export function dedupFindings<T extends Pick<Finding, 'sourceUrl'>>(findings: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const f of findings) {
    let hash: string;
    try {
      hash = computeSourceUrlHash(normalizeUrl(f.sourceUrl));
    } catch {
      // malformed URL — drop silently; ScanService logs separately.
      continue;
    }
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push(f);
  }
  return out;
}
