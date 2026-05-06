/**
 * Shared URL normalisation and content-hash helpers.
 *
 * sdd/manual-ingestion ADR-6: single source of truth for dedup logic.
 * Both `apps/api` (manual ingestion) and `apps/scanner` (dedup.helper.ts)
 * import from here to eliminate drift.
 *
 * Design constraints:
 *  - `normalizeUrl` is pure / deterministic: same logical URL → same string.
 *  - `computeSourceUrlHash` accepts `string | Buffer` so callers can hash
 *    raw PDF bytes (Buffer) or normalised URL strings (string) uniformly.
 */

import { createHash } from 'node:crypto';

/**
 * Normalise a URL so that cosmetic variants produce the same output:
 *  - Lower-case scheme and host (path is case-sensitive per RFC 3986).
 *  - Strip the `#fragment` component.
 *  - Sort query parameters lexicographically by key, then by value.
 *  - Remove a single trailing slash from the pathname (not from origin-only URLs).
 *
 * Throws `TypeError` if `url` cannot be parsed by the WHATWG URL API.
 */
export function normalizeUrl(url: string): string {
  const u = new URL(url);

  // Lower-case scheme + host (WHATWG URL already does this, but be explicit).
  u.hostname = u.hostname.toLowerCase();
  u.protocol = u.protocol.toLowerCase();

  // Strip fragment.
  u.hash = '';

  // Sort query params.
  u.searchParams.sort();

  // Strip single trailing slash from pathname (but keep root "/" intact).
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }

  return u.toString();
}

/**
 * Compute the SHA-256 hex digest of `input`.
 * Accepts a `string` (encoded as UTF-8) or a `Buffer` / `Uint8Array`.
 *
 * Used for:
 *  - URL-based alerts: `computeSourceUrlHash(normalizeUrl(url))`
 *  - PDF alerts:       `computeSourceUrlHash(pdfBuffer)`
 *  - Text alerts:      `computeSourceUrlHash('manual:text:' + slug)`
 */
export function computeSourceUrlHash(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}
