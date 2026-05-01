/**
 * Unit tests for the deterministic dedup helpers.
 *
 * Spec: sdd/scanner-vertical-ar/spec R-4-Dedup.
 * Design: sdd/scanner-vertical-ar/design ADR-9.
 */
import { describe, expect, it } from 'vitest';
import { computeSourceUrlHash, dedupFindings, normalizeUrl } from './dedup.helper.js';

describe('normalizeUrl', () => {
  it('lowercases the hostname', () => {
    expect(normalizeUrl('https://WWW.BCRA.GOB.AR/foo')).toBe('https://www.bcra.gob.ar/foo');
  });

  it('drops the fragment', () => {
    expect(normalizeUrl('https://x.com/a#section')).toBe('https://x.com/a');
  });

  it('drops the query string entirely', () => {
    expect(normalizeUrl('https://x.com/a?b=1&c=2')).toBe('https://x.com/a');
  });

  it('strips trailing slashes from pathname', () => {
    expect(normalizeUrl('https://x.com/a///')).toBe('https://x.com/a');
  });

  it('preserves a single root slash', () => {
    expect(normalizeUrl('https://x.com/')).toBe('https://x.com/');
  });

  it('treats querystring permutations as equivalent', () => {
    expect(normalizeUrl('https://x.com/p?b=2&a=1')).toBe(normalizeUrl('https://x.com/p?a=1&b=2'));
  });

  it('throws on malformed input', () => {
    expect(() => normalizeUrl('not a url')).toThrow();
  });
});

describe('computeSourceUrlHash', () => {
  it('returns 64-char hex sha256', () => {
    const hash = computeSourceUrlHash('https://www.bcra.gob.ar/foo');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is stable across normalization-equivalent URLs', () => {
    const a = computeSourceUrlHash('https://www.bcra.gob.ar/foo/');
    const b = computeSourceUrlHash('https://WWW.BCRA.GOB.AR/foo?utm=1#x');
    expect(a).toBe(b);
  });

  it('differs for different URLs', () => {
    expect(computeSourceUrlHash('https://x.com/a')).not.toBe(
      computeSourceUrlHash('https://x.com/b'),
    );
  });
});

describe('dedupFindings', () => {
  const mk = (sourceUrl: string) => ({
    source: 'BCRA_COMUNICADOS_A' as const,
    sourceUrl,
    title: 't',
    summary: 's',
  });

  it('keeps the first occurrence of each normalized URL', () => {
    const out = dedupFindings([
      mk('https://www.bcra.gob.ar/a'),
      mk('https://WWW.BCRA.GOB.AR/a/'),
      mk('https://www.bcra.gob.ar/b'),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.sourceUrl).toBe('https://www.bcra.gob.ar/a');
    expect(out[1]?.sourceUrl).toBe('https://www.bcra.gob.ar/b');
  });

  it('silently drops malformed URLs', () => {
    const out = dedupFindings([mk('not a url'), mk('https://www.bcra.gob.ar/ok')]);
    expect(out).toHaveLength(1);
    expect(out[0]?.sourceUrl).toBe('https://www.bcra.gob.ar/ok');
  });

  it('returns empty for empty input', () => {
    expect(dedupFindings([])).toEqual([]);
  });
});
