/**
 * Unit tests for MX_SOURCES — validates shape, AlertSource membership,
 * HTTPS URLs, and baseDomain consistency.
 *
 * Spec: sdd/jurisdictions-v2/spec R-JV-4.
 */
import { describe, expect, it } from 'vitest';

import { AlertSourceSchema } from '@regwatch/types/scanner';
import { MX_SOURCES } from './mx.js';

describe('MX_SOURCES', () => {
  it('is non-empty', () => {
    expect(MX_SOURCES.length).toBeGreaterThan(0);
  });

  it.each(MX_SOURCES)('$regulator has a valid AlertSource value', ({ regulator }) => {
    expect(AlertSourceSchema.safeParse(regulator).success).toBe(true);
  });

  it.each(MX_SOURCES)('$regulator has an HTTPS searchUrl', ({ searchUrl }) => {
    expect(searchUrl.startsWith('https://')).toBe(true);
    expect(() => new URL(searchUrl)).not.toThrow();
  });

  it.each(MX_SOURCES)(
    '$regulator baseDomain matches searchUrl hostname',
    ({ searchUrl, baseDomain }) => {
      const hostname = new URL(searchUrl).hostname;
      expect(hostname.endsWith(baseDomain)).toBe(true);
    },
  );

  it.each(MX_SOURCES)('$regulator has a non-empty displayName', ({ displayName }) => {
    expect(displayName.trim().length).toBeGreaterThan(0);
  });

  it('includes CNBV_CIRCULARES, CNBV_RESOLUCIONES, and BANXICO_CIRCULARES', () => {
    const regulators = MX_SOURCES.map((s) => s.regulator);
    expect(regulators).toContain('CNBV_CIRCULARES');
    expect(regulators).toContain('CNBV_RESOLUCIONES');
    expect(regulators).toContain('BANXICO_CIRCULARES');
  });
});
