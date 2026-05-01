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
import {
  FindingSchema,
  ScanResultSchema,
  assertNoOrganizationId,
  findingSchemaShapeKeys,
} from './finding.schema.js';

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

describe('assertNoOrganizationId (R-3 chokepoint guard)', () => {
  it('does NOT throw on a happy-path Finding with no organizationId key', () => {
    const finding = {
      source: 'BCRA_COMUNICADOS_A',
      sourceUrl: 'https://www.bcra.gob.ar/foo',
      title: 'OK',
      summary: 'fine',
    };
    expect(() => assertNoOrganizationId(finding)).not.toThrow();
  });

  it('does NOT throw on null / undefined / primitive input', () => {
    expect(() => assertNoOrganizationId(null)).not.toThrow();
    expect(() => assertNoOrganizationId(undefined)).not.toThrow();
    expect(() => assertNoOrganizationId('a string')).not.toThrow();
    expect(() => assertNoOrganizationId(42)).not.toThrow();
  });

  it('does NOT throw on an empty array or empty object', () => {
    expect(() => assertNoOrganizationId([])).not.toThrow();
    expect(() => assertNoOrganizationId({})).not.toThrow();
  });

  it('throws on a direct `organizationId` key', () => {
    expect(() =>
      assertNoOrganizationId({
        source: 'BCRA',
        organizationId: 'evil-tenant-id',
      }),
    ).toThrow(/forbidden key "organizationId"/);
  });

  it('throws on case-variant `OrganizationId`', () => {
    expect(() => assertNoOrganizationId({ OrganizationId: 'x' })).toThrow(
      /forbidden key "OrganizationId"/,
    );
  });

  it('throws on snake_case `organization_id`', () => {
    expect(() => assertNoOrganizationId({ organization_id: 'x' })).toThrow(
      /forbidden key "organization_id"/,
    );
  });

  it('throws on kebab-case `organization-id`', () => {
    expect(() => assertNoOrganizationId({ 'organization-id': 'x' })).toThrow(
      /forbidden key "organization-id"/,
    );
  });

  it('throws on uppercase suffix `organizationID`', () => {
    expect(() => assertNoOrganizationId({ organizationID: 'x' })).toThrow(
      /forbidden key "organizationID"/,
    );
  });

  it('throws on a NESTED `organizationId` key (recursive walk)', () => {
    const payload = {
      source: 'BCRA',
      meta: {
        nested: { organizationId: 'evil' },
      },
    };
    expect(() => assertNoOrganizationId(payload)).toThrow(/forbidden key "organizationId"/);
  });

  it('throws when a `Finding[]` array contains ANY element with organizationId', () => {
    const findings = [
      { source: 'BCRA', title: 'a' },
      { source: 'BCRA', title: 'b', organizationId: 'evil' },
    ];
    expect(() => assertNoOrganizationId(findings)).toThrow(/forbidden key "organizationId"/);
  });

  it('does NOT throw on benign keys that contain "organization" but are not org id', () => {
    // We MUST NOT over-trigger: keys like `organizationName` are fine.
    expect(() =>
      assertNoOrganizationId({
        organizationName: 'Acme',
        organizations: [],
      }),
    ).not.toThrow();
  });

  it('handles cyclic objects without stack overflow (returns without throw)', () => {
    const a: Record<string, unknown> = { name: 'a' };
    const b: Record<string, unknown> = { name: 'b', ref: a };
    a.ref = b;
    expect(() => assertNoOrganizationId(a)).not.toThrow();
  });
});
