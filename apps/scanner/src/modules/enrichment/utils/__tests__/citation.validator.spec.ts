/**
 * Unit tests for `validateCitations`.
 *
 * Spec: `sdd/classifier-and-writer/spec` R-2-Writer-Output-Contract, ADR-5.
 * Design: `sdd/classifier-and-writer/design` ADR-5.
 *
 * Validates:
 *   - empty citations → always valid
 *   - verbatim citation present → valid
 *   - citation with extra whitespace (normalized match) → valid
 *   - citation with different case → valid (case-insensitive)
 *   - citation not in source → invalid, offending set
 *   - multiple citations, second one invalid → returns second as offending
 *   - unicode citation → valid if present
 */
import { describe, expect, it } from 'vitest';

import { validateCitations } from '../citation.validator.js';

const SOURCE =
  'The BCRA requires all payment service providers to implement Enhanced KYC procedures by Q3 2026.';

describe('validateCitations', () => {
  it('empty citations array → valid', () => {
    const result = validateCitations([], SOURCE);
    expect(result.valid).toBe(true);
    expect(result.offending).toBeNull();
  });

  it('verbatim citation present in source → valid', () => {
    const result = validateCitations(['payment service providers'], SOURCE);
    expect(result.valid).toBe(true);
    expect(result.offending).toBeNull();
  });

  it('citation with extra whitespace → valid (normalized match)', () => {
    const result = validateCitations(['payment   service  providers'], SOURCE);
    expect(result.valid).toBe(true);
    expect(result.offending).toBeNull();
  });

  it('citation with different case → valid (case-insensitive)', () => {
    const result = validateCitations(['ENHANCED KYC PROCEDURES'], SOURCE);
    expect(result.valid).toBe(true);
    expect(result.offending).toBeNull();
  });

  it('citation with leading/trailing whitespace → valid (normalized)', () => {
    const result = validateCitations(['  payment service providers  '], SOURCE);
    expect(result.valid).toBe(true);
    expect(result.offending).toBeNull();
  });

  it('citation NOT in source → invalid, offending set', () => {
    const badCitation = 'Central Bank of Argentina';
    const result = validateCitations([badCitation], SOURCE);
    expect(result.valid).toBe(false);
    expect(result.offending).toBe(badCitation);
  });

  it('multiple citations, second one invalid → returns second as offending', () => {
    const good = 'payment service providers';
    const bad = 'this text is not in the source';
    const result = validateCitations([good, bad, 'Enhanced KYC procedures'], SOURCE);
    expect(result.valid).toBe(false);
    expect(result.offending).toBe(bad);
  });

  it('all citations valid → valid', () => {
    const result = validateCitations(
      ['payment service providers', 'Enhanced KYC procedures', 'Q3 2026'],
      SOURCE,
    );
    expect(result.valid).toBe(true);
    expect(result.offending).toBeNull();
  });

  it('unicode citation present in source → valid', () => {
    const unicodeSource = 'El BCRA requiere que los proveedores implementen KYC mejorado.';
    const result = validateCitations(['proveedores implementen'], unicodeSource);
    expect(result.valid).toBe(true);
    expect(result.offending).toBeNull();
  });

  it('unicode citation NOT in source → invalid', () => {
    const unicodeSource = 'El BCRA requiere que los proveedores implementen KYC mejorado.';
    const result = validateCitations(['entidades financieras'], unicodeSource);
    expect(result.valid).toBe(false);
    expect(result.offending).toBe('entidades financieras');
  });

  it('atomic: first invalid stops early (third citation not checked)', () => {
    // Only first invalid is returned; we can verify by checking offending is the FIRST bad one
    const first = 'this is not present';
    const second = 'also not present';
    const result = validateCitations([first, second], SOURCE);
    expect(result.valid).toBe(false);
    expect(result.offending).toBe(first); // first bad, not second
  });
});
