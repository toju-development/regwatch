/**
 * Unit tests for packages/db/src/dedup.ts
 * sdd/manual-ingestion B1.7
 *
 * Spec scenarios:
 *  - same URL with/without trailing slash → same hash
 *  - same URL with sorted vs unsorted query params → same hash
 *  - different URLs → different hashes
 *  - Buffer input → same result as string input of same content
 *  - normalizeUrl lowercases scheme and host
 */

import { describe, expect, it } from 'vitest';
import { computeSourceUrlHash, normalizeUrl } from '../dedup.js';

describe('normalizeUrl', () => {
  it('lowercases scheme', () => {
    expect(normalizeUrl('HTTPS://example.com/path')).toMatch(/^https:/);
  });

  it('lowercases host', () => {
    expect(normalizeUrl('https://EXAMPLE.COM/path')).toContain('example.com');
  });

  it('strips trailing slash from pathname', () => {
    const a = normalizeUrl('https://example.com/path/');
    const b = normalizeUrl('https://example.com/path');
    expect(a).toBe(b);
  });

  it('preserves root pathname (no double-slash stripping)', () => {
    const result = normalizeUrl('https://example.com/');
    // Root slash should be kept — origin-only URL is still valid
    expect(result).toMatch(/^https:\/\/example\.com/);
  });

  it('strips fragment', () => {
    const a = normalizeUrl('https://example.com/page#section1');
    const b = normalizeUrl('https://example.com/page');
    expect(a).toBe(b);
  });

  it('sorts query parameters lexicographically', () => {
    const a = normalizeUrl('https://example.com/?z=1&a=2');
    const b = normalizeUrl('https://example.com/?a=2&z=1');
    expect(a).toBe(b);
  });

  it('does not alter path casing', () => {
    // Path is case-sensitive per RFC 3986 — do not lowercase it.
    const result = normalizeUrl('https://example.com/PathCase');
    expect(result).toContain('/PathCase');
  });
});

describe('computeSourceUrlHash', () => {
  it('same URL with vs without trailing slash → same hash', () => {
    const h1 = computeSourceUrlHash(normalizeUrl('https://example.com/page/'));
    const h2 = computeSourceUrlHash(normalizeUrl('https://example.com/page'));
    expect(h1).toBe(h2);
  });

  it('same URL with sorted vs unsorted query params → same hash', () => {
    const h1 = computeSourceUrlHash(normalizeUrl('https://example.com/?b=1&a=2'));
    const h2 = computeSourceUrlHash(normalizeUrl('https://example.com/?a=2&b=1'));
    expect(h1).toBe(h2);
  });

  it('different URLs → different hashes', () => {
    const h1 = computeSourceUrlHash('https://example.com/page-a');
    const h2 = computeSourceUrlHash('https://example.com/page-b');
    expect(h1).not.toBe(h2);
  });

  it('Buffer input → same result as string with same UTF-8 content', () => {
    const content = 'manual:pdf:my-document.pdf';
    const hString = computeSourceUrlHash(content);
    const hBuffer = computeSourceUrlHash(Buffer.from(content, 'utf-8'));
    expect(hString).toBe(hBuffer);
  });

  it('returns a 64-char hex string (SHA-256)', () => {
    const hash = computeSourceUrlHash('https://example.com/');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
