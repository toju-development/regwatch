import { describe, expect, it } from 'vitest';

import {
  JURISDICTION_CODES,
  JURISDICTIONS,
  JURISDICTIONS_BY_CODE,
  JurisdictionCodeSchema,
  type JurisdictionCode,
} from '../src/jurisdictions.js';

describe('jurisdictions registry', () => {
  it('exports the 9 LatAm members in canonical shape', () => {
    expect(JURISDICTIONS).toHaveLength(9);
    expect(JURISDICTION_CODES).toEqual(['MX', 'CO', 'PE', 'CL', 'AR', 'UY', 'BR', 'EC', 'PA']);

    for (const j of JURISDICTIONS) {
      expect(j.code).toMatch(/^[A-Z]{2}$/);
      expect(j.name.length).toBeGreaterThan(0);
      expect(j.region).toBe('LATAM');
    }

    // O(1) lookup carries every code, frozen, and round-trips back to the
    // same source object (defence-in-depth: future hand-mutations explode).
    for (const code of JURISDICTION_CODES) {
      expect(JURISDICTIONS_BY_CODE[code]?.code).toBe(code);
    }
    expect(Object.isFrozen(JURISDICTIONS_BY_CODE)).toBe(true);
  });

  it('JurisdictionCodeSchema accepts every registry code and rejects unknowns', () => {
    for (const code of JURISDICTION_CODES) {
      expect(JurisdictionCodeSchema.parse(code)).toBe(code);
    }

    // Unknown ISO codes (US, ES) and lowercase variants are rejected.
    for (const bad of ['US', 'ES', 'mx', 'XX', '', '  ']) {
      const result = JurisdictionCodeSchema.safeParse(bad as JurisdictionCode);
      expect(result.success).toBe(false);
    }
  });
});
