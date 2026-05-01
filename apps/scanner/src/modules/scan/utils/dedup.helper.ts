/**
 * URL normalization + sha256 hashing + in-memory dedup helpers for `ScanService`.
 *
 * Spec: sdd/scanner-vertical-ar/spec R-4-Dedup (URL normalization, cross-org).
 * Design: sdd/scanner-vertical-ar/design ADR-9 (normalization rules + sha256 hex).
 *
 * Stripping rules (MVP-5):
 *   - lowercase hostname
 *   - drop fragment
 *   - drop query string entirely (revisit if false-negatives in production)
 *   - strip trailing slashes from pathname
 *   - canonical scheme casing (toString already lowercases)
 *
 * Deterministic helper — NEVER exposed as an LLM agent tool (ADR-2: persistence
 * stays out of the agent surface, no LLM-driven `organizationId`).
 */
import { createHash } from 'node:crypto';

import type { Finding } from '@regwatch/types/scanner';

/**
 * Normalize a URL string into a stable comparison form.
 *
 * Throws on invalid URL — caller (`ScanService`) catches and warns.
 */
export function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = '';
  url.search = '';
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

/** sha256 hex (64 chars) of the normalized URL. Used for `Alert.sourceUrlHash`. */
export function computeSourceUrlHash(rawUrl: string): string {
  return createHash('sha256').update(normalizeUrl(rawUrl)).digest('hex');
}

/**
 * In-memory dedup pass before the DB write loop. Keeps the FIRST occurrence of
 * each `sourceUrlHash`. The DB `@@unique([organizationId, sourceUrlHash])`
 * remains the authoritative gate (cross-process race-safe).
 */
export function dedupFindings<T extends Pick<Finding, 'sourceUrl'>>(findings: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const f of findings) {
    let hash: string;
    try {
      hash = computeSourceUrlHash(f.sourceUrl);
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
