import { describe, expect, it } from 'vitest';

import { SCAN_COMPLETED_EVENT, ScanCompletedEventSchema } from '../src/events.js';

describe('SCAN_COMPLETED_EVENT', () => {
  it('is the literal string "scan.completed"', () => {
    expect(SCAN_COMPLETED_EVENT).toBe('scan.completed');
  });
});

describe('ScanCompletedEventSchema', () => {
  const baseValid = {
    scanLogId: 'cl_scan_1',
    organizationId: 'cl_org_1',
    jurisdiction: 'AR',
    status: 'COMPLETED' as const,
    alertsFound: 3,
    tokensUsed: 1234,
    costUsd: '0.012345',
    startedAt: '2026-04-30T12:00:00.000Z',
    completedAt: '2026-04-30T12:00:30.000Z',
    errorMsg: null,
  };

  it('accepts a COMPLETED payload', () => {
    expect(ScanCompletedEventSchema.parse(baseValid).status).toBe('COMPLETED');
  });

  it('accepts SKIPPED_CAP_EXCEEDED with zero counters', () => {
    const out = ScanCompletedEventSchema.parse({
      ...baseValid,
      status: 'SKIPPED_CAP_EXCEEDED',
      alertsFound: 0,
      tokensUsed: 0,
      costUsd: '0',
    });
    expect(out.status).toBe('SKIPPED_CAP_EXCEEDED');
  });

  it('rejects RUNNING / PENDING / unknown status (only terminal events emitted)', () => {
    for (const status of ['RUNNING', 'PENDING', 'WAT']) {
      const r = ScanCompletedEventSchema.safeParse({ ...baseValid, status });
      expect(r.success).toBe(false);
    }
  });

  it('rejects negative counters', () => {
    expect(ScanCompletedEventSchema.safeParse({ ...baseValid, alertsFound: -1 }).success).toBe(
      false,
    );
    expect(ScanCompletedEventSchema.safeParse({ ...baseValid, tokensUsed: -1 }).success).toBe(
      false,
    );
  });

  it('requires costUsd to be a string (Decimal-as-string contract)', () => {
    const r = ScanCompletedEventSchema.safeParse({
      ...baseValid,
      costUsd: 0.012345,
    });
    expect(r.success).toBe(false);
  });
});
