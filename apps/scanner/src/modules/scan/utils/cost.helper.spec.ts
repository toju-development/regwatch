/**
 * Unit tests for `computeCostFromUsageMetadata`.
 *
 * Spec: `sdd/scanner-vertical-ar/spec` R-6-CostAccounting (rates +
 *   Decimal arithmetic), R-14 (Decimal(10,6) precision boundary).
 * Design: `sdd/scanner-vertical-ar/design` ADR-5.
 *
 * Validates:
 *   - zero / missing usageMetadata fields → cost 0, tokens 0
 *   - typical scan (3K in / 2K out) → exact Decimal expectation
 *   - large scan (100K in / 50K out) → exact Decimal expectation
 *   - INV-SP-3 invariant: result is `Prisma.Decimal`, not `number`
 *   - precision: result of single-token cost is preserved past 6 decimals
 */
import { Prisma } from '@regwatch/db/client';
import { describe, expect, it } from 'vitest';

import { computeCostFromUsageMetadata } from './cost.helper.js';

describe('computeCostFromUsageMetadata', () => {
  it('returns 0/0 for empty usageMetadata (R-6 zero-token boundary)', () => {
    const result = computeCostFromUsageMetadata({});
    expect(result.tokensUsed).toBe(0);
    expect(result.costUsd).toBeInstanceOf(Prisma.Decimal);
    expect(result.costUsd.equals(0)).toBe(true);
  });

  it('handles null/undefined token counts defensively', () => {
    const result = computeCostFromUsageMetadata({
      promptTokenCount: null,
      candidatesTokenCount: undefined,
    });
    expect(result.tokensUsed).toBe(0);
    expect(result.costUsd.equals(0)).toBe(true);
  });

  it('typical scan: 3,000 in + 2,000 out = $0.0059 (Decimal)', () => {
    // 3000 * 0.30 / 1e6 = 0.0009
    // 2000 * 2.50 / 1e6 = 0.005
    // sum = 0.0059
    const result = computeCostFromUsageMetadata({
      promptTokenCount: 3000,
      candidatesTokenCount: 2000,
    });
    expect(result.tokensUsed).toBe(5000);
    expect(result.costUsd.toString()).toBe('0.0059');
  });

  it('large scan: 100,000 in + 50,000 out = $0.155 (Decimal)', () => {
    // 100000 * 0.30 / 1e6 = 0.03
    // 50000 * 2.50 / 1e6 = 0.125
    // sum = 0.155
    const result = computeCostFromUsageMetadata({
      promptTokenCount: 100_000,
      candidatesTokenCount: 50_000,
    });
    expect(result.tokensUsed).toBe(150_000);
    expect(result.costUsd.toString()).toBe('0.155');
  });

  it('precision boundary: single token cost is preserved past 6 decimals (R-14)', () => {
    // 1 * 0.30 / 1e6 = 0.0000003 (3e-7) — Decimal(10,6) DB column will round
    // on persist, but the helper itself MUST NOT pre-truncate.
    const result = computeCostFromUsageMetadata({
      promptTokenCount: 1,
      candidatesTokenCount: 0,
    });
    expect(result.costUsd.toString()).toBe('3e-7');
    // Equivalent assertion in plain decimal form:
    expect(result.costUsd.equals(new Prisma.Decimal('0.0000003'))).toBe(true);
  });

  it('matches the spec R-6 example: 50K in + 5K out = 0.0275 (post-rate update)', () => {
    // Spec R-6 was authored under old rates. With current rates ($0.30/$2.50):
    // 50000 * 0.30 / 1e6 = 0.015
    // 5000  * 2.50 / 1e6 = 0.0125
    // sum = 0.0275
    const result = computeCostFromUsageMetadata({
      promptTokenCount: 50_000,
      candidatesTokenCount: 5_000,
    });
    expect(result.tokensUsed).toBe(55_000);
    expect(result.costUsd.toString()).toBe('0.0275');
  });

  it('INV-SP-3: never returns a JS number for costUsd', () => {
    const result = computeCostFromUsageMetadata({
      promptTokenCount: 12345,
      candidatesTokenCount: 6789,
    });
    expect(typeof result.costUsd).toBe('object');
    expect(result.costUsd).toBeInstanceOf(Prisma.Decimal);
  });

  it('truncates fractional token counts (defensive — Gemini returns ints)', () => {
    const result = computeCostFromUsageMetadata({
      promptTokenCount: 3000.7 as unknown as number,
      candidatesTokenCount: 2000.9 as unknown as number,
    });
    expect(result.tokensUsed).toBe(5000);
  });

  it('clamps negative token counts to 0 (defensive)', () => {
    const result = computeCostFromUsageMetadata({
      promptTokenCount: -100,
      candidatesTokenCount: -50,
    });
    expect(result.tokensUsed).toBe(0);
    expect(result.costUsd.equals(0)).toBe(true);
  });
});
