/**
 * Unit tests for `sourcesFor()` in root.agent.ts (MVP-13 extension, POST-10 MX+UY).
 *
 * Verifies that each supported jurisdiction returns its correct SourceSpec[]
 * and that unknown jurisdictions throw a clear error.
 *
 * Spec: sdd/scanners-br-co-pe-cl/spec R-sourcesFor-Returns-Correct-SourceSpec;
 *       sdd/jurisdictions-v2/spec R-JV-2.
 */
import { describe, expect, it } from 'vitest';

import { AR_SOURCES } from '../sources/ar.js';
import { BR_SOURCES } from '../sources/br.js';
import { CL_SOURCES } from '../sources/cl.js';
import { CO_SOURCES } from '../sources/co.js';
import { EC_SOURCES } from '../sources/ec.js';
import { MX_SOURCES } from '../sources/mx.js';
import { PA_SOURCES } from '../sources/pa.js';
import { PE_SOURCES } from '../sources/pe.js';
import { UY_SOURCES } from '../sources/uy.js';
import { sourcesFor } from './root.agent.js';

describe('sourcesFor()', () => {
  it('returns AR_SOURCES for AR', () => {
    expect(sourcesFor('AR')).toBe(AR_SOURCES);
  });

  it('returns BR_SOURCES for BR', () => {
    expect(sourcesFor('BR')).toBe(BR_SOURCES);
  });

  it('returns CO_SOURCES for CO', () => {
    expect(sourcesFor('CO')).toBe(CO_SOURCES);
  });

  it('returns PE_SOURCES for PE', () => {
    expect(sourcesFor('PE')).toBe(PE_SOURCES);
  });

  it('returns CL_SOURCES for CL', () => {
    expect(sourcesFor('CL')).toBe(CL_SOURCES);
  });

  it('returns MX_SOURCES for MX', () => {
    expect(sourcesFor('MX')).toBe(MX_SOURCES);
  });

  it('returns UY_SOURCES for UY', () => {
    expect(sourcesFor('UY')).toBe(UY_SOURCES);
  });

  it('returns EC_SOURCES for EC', () => {
    expect(sourcesFor('EC')).toBe(EC_SOURCES);
  });

  it('returns PA_SOURCES for PA', () => {
    expect(sourcesFor('PA')).toBe(PA_SOURCES);
  });

  it('throws for an unsupported jurisdiction', () => {
    expect(() => sourcesFor('XX')).toThrow(/unsupported jurisdiction/i);
    expect(() => sourcesFor('')).toThrow();
    expect(() => sourcesFor('ZZ')).toThrow(/unsupported jurisdiction/i);
  });

  it.each(['AR', 'BR', 'CO', 'PE', 'CL', 'MX', 'UY', 'EC', 'PA'])(
    'sourcesFor(%s) returns a non-empty array',
    (jurisdiction) => {
      const sources = sourcesFor(jurisdiction);
      expect(sources.length).toBeGreaterThan(0);
    },
  );
});
