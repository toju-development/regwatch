/**
 * Unit tests for UY_SOURCES — validates shape, AlertSource membership,
 * HTTPS URLs, and baseDomain consistency.
 *
 * Spec: sdd/jurisdictions-v2/spec R-JV-5.
 */
import { describe, expect, it } from 'vitest';

import { AlertSourceSchema } from '@regwatch/types/scanner';
import { UY_SOURCES } from './uy.js';

describe('UY_SOURCES', () => {
  it('is non-empty', () => {
    expect(UY_SOURCES.length).toBeGreaterThan(0);
  });

  it.each(UY_SOURCES)('$regulator has a valid AlertSource value', ({ regulator }) => {
    expect(AlertSourceSchema.safeParse(regulator).success).toBe(true);
  });

  it.each(UY_SOURCES)('$regulator has an HTTPS searchUrl', ({ searchUrl }) => {
    expect(searchUrl.startsWith('https://')).toBe(true);
    expect(() => new URL(searchUrl)).not.toThrow();
  });

  it.each(UY_SOURCES)(
    '$regulator baseDomain matches searchUrl hostname',
    ({ searchUrl, baseDomain }) => {
      const hostname = new URL(searchUrl).hostname;
      expect(hostname.endsWith(baseDomain)).toBe(true);
    },
  );

  it.each(UY_SOURCES)('$regulator has a non-empty displayName', ({ displayName }) => {
    expect(displayName.trim().length).toBeGreaterThan(0);
  });

  it('includes BCU_CIRCULARES and BCU_COMUNICACIONES', () => {
    const regulators = UY_SOURCES.map((s) => s.regulator);
    expect(regulators).toContain('BCU_CIRCULARES');
    expect(regulators).toContain('BCU_COMUNICACIONES');
  });
});
