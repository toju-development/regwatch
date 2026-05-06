/**
 * SSRF-safe URL fetcher.
 *
 * sdd/manual-ingestion ADR-3: every external URL fetch in apps/api MUST
 * pass through this guard before any network I/O. Blocks:
 *   - Non-HTTPS schemes.
 *   - RFC 1918 private ranges (10.x, 172.16-31.x, 192.168.x).
 *   - Loopback (127.x, ::1).
 *   - Link-local (169.254.x, fe80::/10).
 *
 * Uses `undici` with a 5 s timeout and a 500 KB body limit.
 * Returns `{ text, title? }` — title is extracted from `<title>` tag
 * when the content-type is HTML.
 */

import { createHash } from 'node:crypto';
import dns from 'node:dns/promises';
import { fetch as undiciFetch } from 'undici';

export { createHash }; // re-exported for consumers that need sha256Hex

/**
 * Thrown when a URL is blocked by the SSRF guard.
 * Controller maps this to HTTP 400.
 */
export class SsrfBlockedError extends Error {
  constructor(reason: string) {
    super(`SSRF guard blocked URL: ${reason}`);
    this.name = 'SsrfBlockedError';
  }
}

/** Max response body size: 500 KB */
const MAX_BODY_BYTES = 500 * 1024;
/** Fetch timeout in ms */
const FETCH_TIMEOUT_MS = 5_000;

const USER_AGENT = 'RegWatch/1.0';

/** Returns the SHA-256 hex digest of a string or Buffer. */
export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Validates that the URL scheme is HTTPS. Throws {@link SsrfBlockedError}
 * otherwise.
 */
function assertHttps(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfBlockedError(`invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new SsrfBlockedError(`only HTTPS is allowed, got ${parsed.protocol}`);
  }
  return parsed;
}

/**
 * Returns true if `ip` is in a private/loopback/link-local range.
 * Supports IPv4 dotted-decimal only (IPv6 literals are handled separately).
 */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false; // Not an IPv4 address — let the IPv6 check handle it.
  }
  const [a, b] = parts as [number, number, number, number];
  // Loopback: 127.0.0.0/8
  if (a === 127) return true;
  // RFC 1918: 10.0.0.0/8
  if (a === 10) return true;
  // RFC 1918: 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // RFC 1918: 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // Link-local: 169.254.0.0/16
  if (a === 169 && b === 254) return true;
  return false;
}

/**
 * Returns true if `ip` is an IPv6 loopback or link-local address.
 */
function isPrivateIpv6(ip: string): boolean {
  const normalised = ip.toLowerCase().replace(/[\[\]]/g, '');
  if (normalised === '::1') return true;
  if (normalised.startsWith('fe80:')) return true;
  return false;
}

/**
 * Resolves `hostname` via DNS and asserts no resolved address falls in a
 * private/loopback/link-local range. Throws {@link SsrfBlockedError} if
 * any address is blocked or resolution fails.
 */
async function assertSafeHostname(hostname: string): Promise<void> {
  // Direct IP literals — no DNS needed.
  if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
    throw new SsrfBlockedError(`IP address ${hostname} is in a private/loopback/link-local range`);
  }

  let records: dns.LookupAddress[];
  try {
    // `all: true` returns every A/AAAA record so we can block multi-homed
    // hosts that mix public and private addresses.
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw new SsrfBlockedError(`DNS resolution failed for hostname: ${hostname}`);
  }

  for (const { address } of records) {
    if (isPrivateIpv4(address) || isPrivateIpv6(address)) {
      throw new SsrfBlockedError(
        `hostname ${hostname} resolved to private/loopback address ${address}`,
      );
    }
  }
}

/** Extracts the content of the first `<title>` tag, or undefined. */
function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return match?.[1]?.trim() || undefined;
}

export interface FetchResult {
  text: string;
  title?: string;
}

/**
 * Fetch a remote URL with SSRF protection.
 *
 * @param url - The URL to fetch. Must be HTTPS.
 * @returns The response body as text, plus an optional `title` from
 *   `<title>` when the content-type is HTML.
 *
 * @throws {@link SsrfBlockedError} if the URL is non-HTTPS or resolves
 *   to a private/loopback/link-local address.
 * @throws `Error` on timeout or body limit exceeded.
 */
export async function fetchUrl(url: string): Promise<FetchResult> {
  const parsed = assertHttps(url);
  await assertSafeHostname(parsed.hostname);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await undiciFetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Fetch timed out after ${FETCH_TIMEOUT_MS}ms for URL: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching URL: ${url}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const isHtml = contentType.includes('text/html');

  // Stream body up to MAX_BODY_BYTES.
  const reader = response.body?.getReader();
  if (!reader) {
    return { text: '' };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > MAX_BODY_BYTES) {
          throw new Error(`Response body exceeds ${MAX_BODY_BYTES} byte limit for URL: ${url}`);
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const text = new TextDecoder().decode(Buffer.concat(chunks));
  const title = isHtml ? extractTitle(text) : undefined;

  return { text, title };
}
