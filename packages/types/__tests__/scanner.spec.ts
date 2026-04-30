import { describe, expect, it } from 'vitest';

import { AlertSourceSchema, FindingSchema, ScanResultSchema } from '../src/scanner.js';

describe('AlertSourceSchema', () => {
  it('accepts the 4 canonical AR sources (BCRA A/B/C + CNV)', () => {
    for (const v of [
      'BCRA_COMUNICADOS_A',
      'BCRA_COMUNICADOS_B',
      'BCRA_COMUNICADOS_C',
      'CNV_RESOLUCIONES_GENERALES',
    ]) {
      expect(AlertSourceSchema.parse(v)).toBe(v);
    }
  });

  it('rejects unknown source values', () => {
    expect(AlertSourceSchema.safeParse('BCRA_FOO').success).toBe(false);
    expect(AlertSourceSchema.safeParse('CNBV_MX_GENERAL').success).toBe(false);
  });
});

describe('FindingSchema', () => {
  it('accepts a minimal valid finding', () => {
    const out = FindingSchema.parse({
      source: 'BCRA_COMUNICADOS_A',
      sourceUrl: 'https://www.bcra.gob.ar/foo/bar',
      title: 'Comunicación A 1234',
      summary: 'Modifica límites de…',
    });
    expect(out.source).toBe('BCRA_COMUNICADOS_A');
  });

  it('SECURITY: silently drops `organizationId` if the LLM hallucinates it (R-3 trust boundary)', () => {
    // Zod 4 strips unknown keys by default — `organizationId` MUST NOT survive
    // into the trusted persistence path.
    const out = FindingSchema.parse({
      source: 'BCRA_COMUNICADOS_A',
      sourceUrl: 'https://www.bcra.gob.ar/foo',
      title: 'Hello',
      summary: 'There',
      organizationId: 'attacker-org',
    } as unknown as Record<string, unknown>);
    expect(out).not.toHaveProperty('organizationId');
  });

  it('rejects a non-URL sourceUrl', () => {
    const r = FindingSchema.safeParse({
      source: 'BCRA_COMUNICADOS_A',
      sourceUrl: 'not-a-url',
      title: 'Hi!',
      summary: '',
    });
    expect(r.success).toBe(false);
  });
});

describe('ScanResultSchema', () => {
  it('accepts findings array up to 50 items', () => {
    const findings = Array.from({ length: 50 }, () => ({
      source: 'CNV_RESOLUCIONES_GENERALES' as const,
      sourceUrl: 'https://www.cnv.gov.ar/x',
      title: 'Res. Gral. 123',
      summary: '',
    }));
    expect(ScanResultSchema.parse({ findings }).findings.length).toBe(50);
  });

  it('rejects more than 50 findings', () => {
    const findings = Array.from({ length: 51 }, () => ({
      source: 'BCRA_COMUNICADOS_A' as const,
      sourceUrl: 'https://www.bcra.gob.ar/x',
      title: 'x',
      summary: '',
    }));
    expect(ScanResultSchema.safeParse({ findings }).success).toBe(false);
  });
});
