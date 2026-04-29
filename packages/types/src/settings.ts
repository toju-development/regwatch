/**
 * Settings Zod schemas — canonical contract shared by `apps/api` (validation
 * pipe + read-time drift fallback), `apps/web` (server action + form), and
 * future `apps/scanner` (consumer of `Settings.jurisdictions`).
 *
 * Spec: `sdd/jurisdictions-config/spec` R-Settings-Schema, R-Settings-Validation.
 * Design: `sdd/jurisdictions-config/design` §0 D6–D7, §6, §4 (DB shape).
 *
 * Error code strings (used as `error` text on individual issues so callers
 * can branch in UI):
 *   EMPTY_JURISDICTIONS, NO_ENABLED_JURISDICTION, DUPLICATE_JURISDICTION_CODE,
 *   INVALID_JURISDICTION_CODE (auto-emitted by `z.enum`), INVALID_DAY_OF_WEEK,
 *   WEEKLY_REQUIRES_SINGLE_DAY, CUSTOM_REQUIRES_DAY_LIST.
 *
 * NOTE: Pure data + Zod. No `'server-only'`, no Node-only deps.
 */
import { z } from 'zod';

import { JURISDICTIONS, JurisdictionCodeSchema } from './jurisdictions.js';

/** One jurisdiction toggle inside `Settings.jurisdictions`. */
export const SettingsJurisdictionSchema = z.object({
  code: JurisdictionCodeSchema,
  enabled: z.boolean(),
  /**
   * Free-text comma/space-separated topics the operator wants the scanner to
   * watch in this jurisdiction. Bounded so it cannot blow up the JSON column
   * or downstream Gemini prompts (future MVP-5 guard).
   */
  customTopics: z.string().max(2000).default(''),
});

/**
 * Whole-array shape with cross-row invariants:
 *  - non-empty (`EMPTY_JURISDICTIONS`)
 *  - at least one enabled (`NO_ENABLED_JURISDICTION`)
 *  - no duplicate codes (`DUPLICATE_JURISDICTION_CODE`)
 */
export const SettingsJurisdictionsSchema = z
  .array(SettingsJurisdictionSchema)
  .min(1, { error: 'EMPTY_JURISDICTIONS' })
  .refine((arr) => arr.some((j) => j.enabled), { error: 'NO_ENABLED_JURISDICTION' })
  .refine((arr) => new Set(arr.map((j) => j.code)).size === arr.length, {
    error: 'DUPLICATE_JURISDICTION_CODE',
  });

/** Cadence enum — TS-only string (per design D3, no Postgres enum). */
export const ScanScheduleSchema = z.enum(['daily', 'weekly', 'custom']);
export type ScanSchedule = z.infer<typeof ScanScheduleSchema>;

/** `mon|tue|...|sun` or CSV thereof. Empty string rejected. */
export const ScanDaySchema = z
  .string()
  .regex(/^(mon|tue|wed|thu|fri|sat|sun)(,(mon|tue|wed|thu|fri|sat|sun))*$/, {
    error: 'INVALID_DAY_OF_WEEK',
  });

/** Hour-of-day, 24h clock. */
export const ScanHourSchema = z.number().int().min(0).max(23);

/**
 * Body shape for `PUT /org/:orgId/settings`. Full-replace (no PATCH per D12).
 *
 * `superRefine` enforces:
 *  - WEEKLY → `scanDay` must be a SINGLE day (no comma).
 *  - CUSTOM → `scanDay` must list at least one day (regex already requires
 *    one, so this is a defensive check that will only trip if the regex is
 *    relaxed in future).
 *  - DAILY  → `scanDay` is ignored at the service layer; we accept any valid
 *    string here and normalise on save (per design §6 inline note).
 */
export const UpdateSettingsSchema = z
  .object({
    jurisdictions: SettingsJurisdictionsSchema,
    scanSchedule: ScanScheduleSchema,
    scanDay: ScanDaySchema,
    scanHour: ScanHourSchema,
  })
  .superRefine((v, ctx) => {
    if (v.scanSchedule === 'weekly' && v.scanDay.includes(',')) {
      ctx.addIssue({
        code: 'custom',
        path: ['scanDay'],
        message: 'WEEKLY_REQUIRES_SINGLE_DAY',
      });
    }
    if (v.scanSchedule === 'custom') {
      const days = v.scanDay
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
      if (days.length < 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['scanDay'],
          message: 'CUSTOM_REQUIRES_DAY_LIST',
        });
      }
    }
  });

export type UpdateSettingsInput = z.infer<typeof UpdateSettingsSchema>;
export type SettingsJurisdictions = z.infer<typeof SettingsJurisdictionsSchema>;
export type SettingsJurisdiction = z.infer<typeof SettingsJurisdictionSchema>;

/**
 * Defaults used by `SettingsService.getOrCreate` on lazy first-GET.
 * All 7 LatAm jurisdictions enabled; weekly Monday at 08:00 (per design §4).
 */
export const DEFAULT_SETTINGS: UpdateSettingsInput = {
  jurisdictions: JURISDICTIONS.map((j) => ({
    code: j.code,
    enabled: true,
    customTopics: '',
  })),
  scanSchedule: 'weekly',
  scanDay: 'mon',
  scanHour: 8,
};
