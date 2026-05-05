/**
 * Unit tests for `ClassifierOutputSchema` and `WriterOutputSchema`.
 *
 * Spec: `sdd/classifier-and-writer/spec` R-1-Classifier-Output-Contract,
 *   R-2-Writer-Output-Contract, R-6-Trust-Boundary.
 * Design: `sdd/classifier-and-writer/design` ADR-11 (.strict() first fence).
 *
 * Validates:
 *   - valid parse for both schemas
 *   - `.strict()` rejects extra keys (e.g. injected `organizationId`)
 *   - severity out of range (UNKNOWN rejected from ClassifierOutput)
 *   - relevanceScore bounds (0..100 Int)
 *   - WriterOutput citation min (≥1) and max (≤10) enforcement
 */
import { describe, expect, it } from 'vitest';

import { AlertTopic, ClassifierOutputSchema, WriterOutputSchema } from '../enrichment.js';

// ─── ClassifierOutputSchema ───────────────────────────────────────────────────

describe('ClassifierOutputSchema', () => {
  const VALID: Record<string, unknown> = {
    topic: AlertTopic.FX,
    severity: 'HIGH',
    relevanceScore: 80,
    relevant: true,
  };

  it('parses a valid classifier output', () => {
    const result = ClassifierOutputSchema.safeParse(VALID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.topic).toBe('FX');
      expect(result.data.severity).toBe('HIGH');
      expect(result.data.relevanceScore).toBe(80);
      expect(result.data.relevant).toBe(true);
    }
  });

  it('parses all valid severity values', () => {
    for (const severity of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const) {
      const result = ClassifierOutputSchema.safeParse({ ...VALID, severity });
      expect(result.success, `severity ${severity} should be valid`).toBe(true);
    }
  });

  it('rejects UNKNOWN severity (failure-only sentinel, not a Classifier output)', () => {
    const result = ClassifierOutputSchema.safeParse({ ...VALID, severity: 'UNKNOWN' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown severity value', () => {
    const result = ClassifierOutputSchema.safeParse({ ...VALID, severity: 'CATASTROPHIC' });
    expect(result.success).toBe(false);
  });

  it('rejects relevanceScore below 0', () => {
    const result = ClassifierOutputSchema.safeParse({ ...VALID, relevanceScore: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects relevanceScore above 100', () => {
    const result = ClassifierOutputSchema.safeParse({ ...VALID, relevanceScore: 101 });
    expect(result.success).toBe(false);
  });

  it('accepts relevanceScore boundary values: 0 and 100', () => {
    expect(ClassifierOutputSchema.safeParse({ ...VALID, relevanceScore: 0 }).success).toBe(true);
    expect(ClassifierOutputSchema.safeParse({ ...VALID, relevanceScore: 100 }).success).toBe(true);
  });

  it('rejects a non-integer relevanceScore', () => {
    const result = ClassifierOutputSchema.safeParse({ ...VALID, relevanceScore: 50.5 });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid topic not in AlertTopic', () => {
    const result = ClassifierOutputSchema.safeParse({ ...VALID, topic: 'TAXATION' });
    expect(result.success).toBe(false);
  });

  it('accepts all AlertTopic values', () => {
    for (const topic of Object.values(AlertTopic)) {
      const result = ClassifierOutputSchema.safeParse({ ...VALID, topic });
      expect(result.success, `topic ${topic} should be valid`).toBe(true);
    }
  });

  // Security: .strict() rejects extra keys (first fence, ADR-11)
  it('rejects organizationId injection via .strict()', () => {
    const result = ClassifierOutputSchema.safeParse({
      ...VALID,
      organizationId: 'evil-org-id',
    });
    expect(result.success).toBe(false);
  });

  it('rejects userId injection via .strict()', () => {
    const result = ClassifierOutputSchema.safeParse({ ...VALID, userId: 'evil-user' });
    expect(result.success).toBe(false);
  });
});

// ─── WriterOutputSchema ───────────────────────────────────────────────────────

describe('WriterOutputSchema', () => {
  const VALID_CITATION = 'The regulation requires immediate disclosure';
  const VALID: Record<string, unknown> = {
    executiveSummary:
      'The BCRA issued communication A 7890 requiring all payment service providers to implement enhanced KYC procedures by Q3 2026.',
    whatChangesForYou: 'You must update your onboarding flow before July 2026.',
    citations: [VALID_CITATION],
  };

  it('parses a valid writer output', () => {
    const result = WriterOutputSchema.safeParse(VALID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.citations).toHaveLength(1);
    }
  });

  it('rejects executiveSummary shorter than 50 chars', () => {
    const result = WriterOutputSchema.safeParse({ ...VALID, executiveSummary: 'Too short.' });
    expect(result.success).toBe(false);
  });

  it('rejects executiveSummary longer than 2000 chars', () => {
    const result = WriterOutputSchema.safeParse({
      ...VALID,
      executiveSummary: 'x'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it('rejects whatChangesForYou shorter than 20 chars', () => {
    const result = WriterOutputSchema.safeParse({ ...VALID, whatChangesForYou: 'Too short.' });
    expect(result.success).toBe(false);
  });

  it('rejects empty citations array (spec R-2: ≥1 required)', () => {
    const result = WriterOutputSchema.safeParse({ ...VALID, citations: [] });
    expect(result.success).toBe(false);
  });

  it('rejects more than 10 citations', () => {
    const result = WriterOutputSchema.safeParse({
      ...VALID,
      citations: Array(11).fill(VALID_CITATION),
    });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 10 citations', () => {
    const result = WriterOutputSchema.safeParse({
      ...VALID,
      citations: Array(10).fill(VALID_CITATION),
    });
    expect(result.success).toBe(true);
  });

  it('rejects a citation shorter than 10 chars', () => {
    const result = WriterOutputSchema.safeParse({ ...VALID, citations: ['Too short'] });
    expect(result.success).toBe(false);
  });

  // Security: .strict() rejects extra keys (first fence, ADR-11)
  it('rejects organizationId injection via .strict()', () => {
    const result = WriterOutputSchema.safeParse({
      ...VALID,
      organizationId: 'evil-org-id',
    });
    expect(result.success).toBe(false);
  });
});
