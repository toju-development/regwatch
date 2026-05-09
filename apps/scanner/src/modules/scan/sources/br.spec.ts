/**
 * Unit tests for BR_SOURCES — validates shape, AlertSource membership,
 * HTTPS URLs, and baseDomain consistency.
 *
 * Spec: sdd/scanners-br-co-pe-cl/spec R-AlertSource-Enum-Extended,
 *   R-as-const-satisfies enforcement (compile-time) + runtime shape guards.
 */
import { describe, expect, it } from 'vitest';

import { AlertSourceSchema } from '@regwatch/types/scanner';
import { BR_SOURCES } from './br.js';

describe('BR_SOURCES', () => {
  it('is non-empty', () => {
    expect(BR_SOURCES.length).toBeGreaterThan(0);
  });

  it.each(BR_SOURCES)('$regulator has a valid AlertSource value', ({ regulator }) => {
    expect(AlertSourceSchema.safeParse(regulator).success).toBe(true);
  });

  it.each(BR_SOURCES)('$regulator has an HTTPS searchUrl', ({ searchUrl }) => {
    expect(searchUrl.startsWith('https://')).toBe(true);
    expect(() => new URL(searchUrl)).not.toThrow();
  });

  it.each(BR_SOURCES)(
    '$regulator baseDomain matches searchUrl hostname',
    ({ searchUrl, baseDomain }) => {
      const hostname = new URL(searchUrl).hostname;
      expect(hostname.endsWith(baseDomain)).toBe(true);
    },
  );

  it.each(BR_SOURCES)('$regulator has a non-empty displayName', ({ displayName }) => {
    expect(displayName.trim().length).toBeGreaterThan(0);
  });
});
