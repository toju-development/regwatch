/**
 * Unit tests for `ScanScheduleSchema` and `UpdateSettingsSchema`.
 *
 * Spec: sdd/scheduler-per-org/spec R-Settings-Cadence-Monthly.
 */
import { describe, expect, it } from 'vitest';

import { ScanScheduleSchema, UpdateSettingsSchema } from '../settings.js';

const BASE_JURISDICTIONS = [{ code: 'AR' as const, enabled: true, customTopics: '' }];

describe('ScanScheduleSchema — monthly cadence', () => {
  it("accepts 'monthly' as a valid value", () => {
    const result = ScanScheduleSchema.safeParse('monthly');
    expect(result.success).toBe(true);
  });

  it("rejects unknown values like 'biweekly'", () => {
    const result = ScanScheduleSchema.safeParse('biweekly');
    expect(result.success).toBe(false);
  });
});

describe('UpdateSettingsSchema — monthly + scanDayOfMonth', () => {
  it('accepts valid monthly body with scanDayOfMonth=15', () => {
    const result = UpdateSettingsSchema.safeParse({
      jurisdictions: BASE_JURISDICTIONS,
      scanSchedule: 'monthly',
      scanDay: 'mon',
      scanHour: 8,
      scanDayOfMonth: 15,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scanDayOfMonth).toBe(15);
    }
  });

  it('accepts monthly body without scanDayOfMonth (optional field)', () => {
    const result = UpdateSettingsSchema.safeParse({
      jurisdictions: BASE_JURISDICTIONS,
      scanSchedule: 'monthly',
      scanDay: 'mon',
      scanHour: 8,
    });
    expect(result.success).toBe(true);
  });

  it('rejects scanDayOfMonth=31 (out of 1-28 range)', () => {
    const result = UpdateSettingsSchema.safeParse({
      jurisdictions: BASE_JURISDICTIONS,
      scanSchedule: 'monthly',
      scanDay: 'mon',
      scanHour: 8,
      scanDayOfMonth: 31,
    });
    expect(result.success).toBe(false);
  });

  it('rejects scanDayOfMonth=0 (below min)', () => {
    const result = UpdateSettingsSchema.safeParse({
      jurisdictions: BASE_JURISDICTIONS,
      scanSchedule: 'monthly',
      scanDay: 'mon',
      scanHour: 8,
      scanDayOfMonth: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects scanDayOfMonth=29 (above max=28)', () => {
    const result = UpdateSettingsSchema.safeParse({
      jurisdictions: BASE_JURISDICTIONS,
      scanSchedule: 'monthly',
      scanDay: 'mon',
      scanHour: 8,
      scanDayOfMonth: 29,
    });
    expect(result.success).toBe(false);
  });

  it('accepts scanDayOfMonth=1 (boundary min)', () => {
    const result = UpdateSettingsSchema.safeParse({
      jurisdictions: BASE_JURISDICTIONS,
      scanSchedule: 'monthly',
      scanDay: 'mon',
      scanHour: 8,
      scanDayOfMonth: 1,
    });
    expect(result.success).toBe(true);
  });

  it('accepts scanDayOfMonth=28 (boundary max)', () => {
    const result = UpdateSettingsSchema.safeParse({
      jurisdictions: BASE_JURISDICTIONS,
      scanSchedule: 'monthly',
      scanDay: 'mon',
      scanHour: 8,
      scanDayOfMonth: 28,
    });
    expect(result.success).toBe(true);
  });
});
