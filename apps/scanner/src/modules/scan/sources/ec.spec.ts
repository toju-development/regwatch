/**
 * Unit tests for EC_SOURCES — validates shape, AlertSource membership,
 * HTTPS URLs, and baseDomain consistency.
 *
 * Spec: sdd/jurisdictions-v3/spec R-JV3-6.
 */
import { describe, expect, it } from 'vitest';

import { AlertSourceSchema } from '@regwatch/types/scanner';
import { EC_SOURCES } from './ec.js';

describe('EC_SOURCES', () => {
  it('has exactly 2 sources', () => {
    expect(EC_SOURCES).toHaveLength(2);
  });

  it.each(EC_SOURCES)('$regulator has a valid AlertSource value', ({ regulator }) => {
    expect(AlertSourceSchema.safeParse(regulator).success).toBe(true);
  });

  it('all regulators start with SB_EC_ prefix (EC jurisdiction)', () => {
    for (const s of EC_SOURCES) {
      expect(s.regulator.startsWith('SB_EC_')).toBe(true);
    }
  });

  it.each(EC_SOURCES)('$regulator has an HTTPS searchUrl', ({ searchUrl }) => {
    expect(searchUrl.startsWith('https://')).toBe(true);
    expect(() => new URL(searchUrl)).not.toThrow();
  });

  it.each(EC_SOURCES)(
    '$regulator baseDomain matches searchUrl hostname',
    ({ searchUrl, baseDomain }) => {
      const hostname = new URL(searchUrl).hostname;
      expect(hostname.endsWith(baseDomain)).toBe(true);
    },
  );

  it.each(EC_SOURCES)('$regulator has a non-empty displayName', ({ displayName }) => {
    expect(displayName.trim().length).toBeGreaterThan(0);
  });

  it('includes SB_EC_RESOLUCIONES and SB_EC_CIRCULARES', () => {
    const regulators = EC_SOURCES.map((s) => s.regulator);
    expect(regulators).toContain('SB_EC_RESOLUCIONES');
    expect(regulators).toContain('SB_EC_CIRCULARES');
  });
});
