/**
 * Unit tests for `shouldScanNow`.
 *
 * Spec: sdd/scanner-vertical-ar/spec R-7.
 * Design: sdd/scanner-vertical-ar/design ADR-3 + ADR-4.
 *
 * UTC-only MVP-5; lowercase day strings per ScanDaySchema.
 */
import { describe, expect, it } from 'vitest';
import { shouldScanNow, type CadenceSettings } from './cadence.helper.js';

// 2026-04-29 is a Wednesday (UTC). Use this as the canonical anchor.
const WED_2026_04_29_08 = new Date('2026-04-29T08:00:00Z'); // Wednesday 08:00 UTC
const WED_2026_04_29_09 = new Date('2026-04-29T09:00:00Z'); // Wednesday 09:00 UTC
const MON_2026_04_27_08 = new Date('2026-04-27T08:00:00Z'); // Monday    08:00 UTC
const SUN_2026_04_26_00 = new Date('2026-04-26T00:00:00Z'); // Sunday    00:00 UTC

describe('shouldScanNow — hour gate (cheap short-circuit)', () => {
  it('returns false when current hour does not equal Settings.scanHour', () => {
    const s: CadenceSettings = { scanSchedule: 'daily', scanDay: 'mon', scanHour: 8 };
    expect(shouldScanNow(s, WED_2026_04_29_09)).toBe(false);
  });

  it('handles scanHour=0 (midnight UTC) correctly — no falsy bug', () => {
    const s: CadenceSettings = { scanSchedule: 'daily', scanDay: 'mon', scanHour: 0 };
    expect(shouldScanNow(s, SUN_2026_04_26_00)).toBe(true);
    expect(shouldScanNow(s, WED_2026_04_29_08)).toBe(false); // 08 !== 0
  });
});

describe('shouldScanNow — daily', () => {
  it('fires on every day at the configured hour, regardless of scanDay', () => {
    const s: CadenceSettings = { scanSchedule: 'daily', scanDay: 'mon', scanHour: 8 };
    expect(shouldScanNow(s, WED_2026_04_29_08)).toBe(true);
    expect(shouldScanNow(s, MON_2026_04_27_08)).toBe(true);
  });
});

describe('shouldScanNow — weekly', () => {
  it('fires only on the single scanDay at the configured hour', () => {
    const s: CadenceSettings = { scanSchedule: 'weekly', scanDay: 'mon', scanHour: 8 };
    expect(shouldScanNow(s, MON_2026_04_27_08)).toBe(true);
    expect(shouldScanNow(s, WED_2026_04_29_08)).toBe(false);
  });

  it('compares case-insensitively (defensive — schema enforces lowercase)', () => {
    const s: CadenceSettings = { scanSchedule: 'weekly', scanDay: 'WED', scanHour: 8 };
    expect(shouldScanNow(s, WED_2026_04_29_08)).toBe(true);
  });

  it('matches Sunday correctly (DOW index 0)', () => {
    const s: CadenceSettings = { scanSchedule: 'weekly', scanDay: 'sun', scanHour: 0 };
    expect(shouldScanNow(s, SUN_2026_04_26_00)).toBe(true);
  });
});

describe('shouldScanNow — custom (CSV)', () => {
  it('fires when current UTC day is ANY day in the CSV', () => {
    const s: CadenceSettings = { scanSchedule: 'custom', scanDay: 'mon,wed,fri', scanHour: 8 };
    expect(shouldScanNow(s, MON_2026_04_27_08)).toBe(true);
    expect(shouldScanNow(s, WED_2026_04_29_08)).toBe(true);
  });

  it('does not fire when current UTC day is not in the CSV', () => {
    const s: CadenceSettings = { scanSchedule: 'custom', scanDay: 'tue,thu', scanHour: 8 };
    expect(shouldScanNow(s, WED_2026_04_29_08)).toBe(false);
  });

  it('handles whitespace around CSV entries', () => {
    const s: CadenceSettings = { scanSchedule: 'custom', scanDay: 'mon, wed , fri', scanHour: 8 };
    expect(shouldScanNow(s, WED_2026_04_29_08)).toBe(true);
  });
});

describe('shouldScanNow — unknown schedule (defensive)', () => {
  it('returns false for an unknown scanSchedule value', () => {
    const s: CadenceSettings = { scanSchedule: 'BOGUS', scanDay: 'mon', scanHour: 8 };
    expect(shouldScanNow(s, MON_2026_04_27_08)).toBe(false);
  });
});
