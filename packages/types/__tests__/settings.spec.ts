import { describe, expect, it } from 'vitest';

import { SETTINGS_UPDATED_EVENT, SettingsUpdatedEventSchema } from '../src/events.js';
import {
  DEFAULT_SETTINGS,
  UpdateSettingsSchema,
  type UpdateSettingsInput,
} from '../src/settings.js';

const validBody: UpdateSettingsInput = DEFAULT_SETTINGS;

describe('UpdateSettingsSchema — invalid bodies', () => {
  // 8 cases collapsed via it.each (per tasks B1).
  it.each<{
    name: string;
    body: unknown;
  }>([
    {
      name: 'empty jurisdictions array (EMPTY_JURISDICTIONS)',
      body: { ...validBody, jurisdictions: [] },
    },
    {
      name: 'no enabled jurisdiction (NO_ENABLED_JURISDICTION)',
      body: {
        ...validBody,
        jurisdictions: validBody.jurisdictions.map((j) => ({ ...j, enabled: false })),
      },
    },
    {
      name: 'duplicate jurisdiction codes (DUPLICATE_JURISDICTION_CODE)',
      body: {
        ...validBody,
        jurisdictions: [
          { code: 'AR', enabled: true, customTopics: '' },
          { code: 'AR', enabled: true, customTopics: '' },
        ],
      },
    },
    {
      name: 'unknown jurisdiction code (US)',
      body: {
        ...validBody,
        jurisdictions: [{ code: 'US', enabled: true, customTopics: '' }],
      },
    },
    {
      name: 'weekly schedule with CSV scanDay (WEEKLY_REQUIRES_SINGLE_DAY)',
      body: { ...validBody, scanSchedule: 'weekly', scanDay: 'mon,tue' },
    },
    {
      name: 'invalid scanDay token (INVALID_DAY_OF_WEEK)',
      body: { ...validBody, scanDay: 'xyz' },
    },
    {
      name: 'scanHour out of range (24)',
      body: { ...validBody, scanHour: 24 },
    },
    {
      name: 'scanHour negative (-1)',
      body: { ...validBody, scanHour: -1 },
    },
  ])('rejects: $name', ({ body }) => {
    const result = UpdateSettingsSchema.safeParse(body);
    expect(result.success).toBe(false);
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('has all 9 jurisdictions enabled and weekly/mon/8 cadence', () => {
    expect(DEFAULT_SETTINGS.jurisdictions).toHaveLength(9);
    expect(DEFAULT_SETTINGS.jurisdictions.every((j) => j.enabled)).toBe(true);
    expect(DEFAULT_SETTINGS.scanSchedule).toBe('weekly');
    expect(DEFAULT_SETTINGS.scanDay).toBe('mon');
    expect(DEFAULT_SETTINGS.scanHour).toBe(8);

    // Defaults must round-trip through the validator (or the lazy
    // getOrCreate would explode on the very row it just inserted).
    expect(UpdateSettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });
});

describe('UpdateSettingsSchema — custom requires non-empty day list', () => {
  // Regression: previously `scanDay.split(',').length < 1` was dead code
  // (always >= 1), so an empty/whitespace-only `scanDay` under `custom`
  // mode was not caught by the cross-field guard. Per-token regex on
  // `ScanDaySchema` already rejects these strings, but we now also
  // surface `CUSTOM_REQUIRES_DAY_LIST` as a defensive cross-field
  // invariant in case the regex is ever relaxed.
  it('rejects custom schedule with empty scanDay', () => {
    const result = UpdateSettingsSchema.safeParse({
      ...validBody,
      scanSchedule: 'custom',
      scanDay: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects custom schedule with whitespace-only scanDay tokens', () => {
    const result = UpdateSettingsSchema.safeParse({
      ...validBody,
      scanSchedule: 'custom',
      scanDay: '  ,  ,  ',
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateSettingsSchema — daily/weekly invariants', () => {
  it('accepts daily with any single day, weekly with single day, custom with CSV', () => {
    expect(
      UpdateSettingsSchema.safeParse({ ...validBody, scanSchedule: 'daily', scanDay: 'wed' })
        .success,
    ).toBe(true);

    expect(
      UpdateSettingsSchema.safeParse({ ...validBody, scanSchedule: 'weekly', scanDay: 'fri' })
        .success,
    ).toBe(true);

    expect(
      UpdateSettingsSchema.safeParse({
        ...validBody,
        scanSchedule: 'custom',
        scanDay: 'mon,wed,fri',
      }).success,
    ).toBe(true);
  });
});

describe('SettingsUpdatedEventSchema', () => {
  it('round-trips a valid payload and exposes the canonical event name', () => {
    expect(SETTINGS_UPDATED_EVENT).toBe('settings.updated');

    const payload = {
      organizationId: 'org_cuid_demo',
      actorId: 'user_cuid_demo',
      jurisdictions: validBody.jurisdictions,
      scanSchedule: validBody.scanSchedule,
      scanDay: validBody.scanDay,
      scanHour: validBody.scanHour,
      updatedAt: '2026-04-29T18:00:00.000Z',
    };
    const result = SettingsUpdatedEventSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organizationId).toBe('org_cuid_demo');
    }
  });
});
