/**
 * Unit tests for PA_SOURCES — validates shape, AlertSource membership,
 * HTTPS URLs, and baseDomain consistency.
 *
 * Spec: sdd/jurisdictions-v3/spec R-JV3-7.
 */
import { describe, expect, it } from 'vitest';

import { AlertSourceSchema } from '@regwatch/types/scanner';
import { PA_SOURCES } from './pa.js';

describe('PA_SOURCES', () => {
  it('has exactly 2 sources', () => {
    expect(PA_SOURCES).toHaveLength(2);
  });

  it.each(PA_SOURCES)('$regulator has a valid AlertSource value', ({ regulator }) => {
    expect(AlertSourceSchema.safeParse(regulator).success).toBe(true);
  });

  it.each(PA_SOURCES)('$regulator has an HTTPS searchUrl', ({ searchUrl }) => {
    expect(searchUrl.startsWith('https://')).toBe(true);
    expect(() => new URL(searchUrl)).not.toThrow();
  });

  it.each(PA_SOURCES)(
    '$regulator baseDomain matches searchUrl hostname',
    ({ searchUrl, baseDomain }) => {
      const hostname = new URL(searchUrl).hostname;
      expect(hostname.endsWith(baseDomain)).toBe(true);
    },
  );

  it.each(PA_SOURCES)('$regulator has a non-empty displayName', ({ displayName }) => {
    expect(displayName.trim().length).toBeGreaterThan(0);
  });

  it('includes SBP_ACUERDOS and SBP_RESOLUCIONES', () => {
    const regulators = PA_SOURCES.map((s) => s.regulator);
    expect(regulators).toContain('SBP_ACUERDOS');
    expect(regulators).toContain('SBP_RESOLUCIONES');
  });
});
