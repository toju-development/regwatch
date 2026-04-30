/**
 * R-3 invariant tests: `FindingSchema` MUST NEVER carry `organizationId`.
 *
 * If this test fails, a security boundary regressed — STOP, do not merge,
 * fix the schema in `packages/types/src/scanner.ts`.
 *
 * Spec: sdd/scanner-vertical-ar/spec R-3-ScanServiceChokepoint.
 * Design: sdd/scanner-vertical-ar/design ADR-2, ADR-15.
 */
import { describe, expect, it } from 'vitest';
import { FindingSchema, ScanResultSchema, findingSchemaShapeKeys } from './finding.schema.js';

describe('FindingSchema (R-3 invariant)', () => {
  it('does NOT declare an `organizationId` shape key', () => {
    const keys = findingSchemaShapeKeys();
    expect(keys).not.toContain('organizationId');
    expect(keys).not.toContain('orgId');
  });

  it('strips/ignores any `organizationId` smuggled in by the LLM (defense-in-depth)', () => {
    const malicious = {
      source: 'BCRA_COMUNICADOS_A',
      sourceUrl: 'https://www.bcra.gob.ar/foo',
      title: 'Comunicación A 1234',
      summary: 'Test summary',
      organizationId: 'evil-tenant-id', // attempted injection
    };
    const parsed = FindingSchema.parse(malicious);
    // Zod by default strips unknown keys → `organizationId` MUST NOT survive.
    expect((parsed as Record<string, unknown>).organizationId).toBeUndefined();
  });

  it('rejects payloads exceeding the 50-finding cap (R-1)', () => {
    const findings = Array.from({ length: 51 }, () => ({
      source: 'BCRA_COMUNICADOS_A' as const,
      sourceUrl: 'https://www.bcra.gob.ar/x',
      title: 'abc',
      summary: 's',
    }));
    expect(() => ScanResultSchema.parse({ findings })).toThrow();
  });

  it('accepts a valid empty result', () => {
    expect(ScanResultSchema.parse({ findings: [] })).toEqual({ findings: [] });
  });
});
