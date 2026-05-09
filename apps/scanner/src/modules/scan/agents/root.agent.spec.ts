/**
 * Unit tests for `sourcesFor()` in root.agent.ts (MVP-13 extension).
 *
 * Verifies that each supported jurisdiction returns its correct SourceSpec[]
 * and that unknown jurisdictions throw a clear error.
 *
 * Spec: sdd/scanners-br-co-pe-cl/spec R-sourcesFor-Returns-Correct-SourceSpec.
 */
import { describe, expect, it } from 'vitest';

import { AR_SOURCES } from '../sources/ar.js';
import { BR_SOURCES } from '../sources/br.js';
import { CL_SOURCES } from '../sources/cl.js';
import { CO_SOURCES } from '../sources/co.js';
import { PE_SOURCES } from '../sources/pe.js';
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

  it('throws for an unsupported jurisdiction', () => {
    expect(() => sourcesFor('MX')).toThrow(/unsupported jurisdiction/i);
    expect(() => sourcesFor('')).toThrow();
    expect(() => sourcesFor('UY')).toThrow(/unsupported jurisdiction/i);
  });

  it.each(['AR', 'BR', 'CO', 'PE', 'CL'])(
    'sourcesFor(%s) returns a non-empty array',
    (jurisdiction) => {
      const sources = sourcesFor(jurisdiction);
      expect(sources.length).toBeGreaterThan(0);
    },
  );
});
