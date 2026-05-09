/**
 * MVP-5 cadence translator — `shouldScanNow(settings, now)` decides whether
 * the global hourly cron tick should fire `ScanService.runScan(orgId)` for
 * a given org's `Settings` row.
 *
 * Spec: sdd/scanner-vertical-ar/spec R-7 (cron + cadence honoring
 * `Settings.scanSchedule|scanDay|scanHour`);
 * sdd/scheduler-per-org/spec R-Cadence-Monthly (monthly cadence).
 * Design: sdd/scanner-vertical-ar/design ADR-3 + ADR-4.
 *
 * UTC-only. Day strings are lowercase per `ScanDaySchema`
 * (`packages/types/src/settings.ts`): `mon|tue|wed|thu|fri|sat|sun`.
 *
 * Pure function — no DI, no I/O. Trusts the `Settings` row (already
 * Zod-validated on PUT by capability/settings R-Settings-Validation).
 */

/** Settings shape consumed by the helper — kept structural to avoid Prisma coupling in tests. */
export interface CadenceSettings {
  scanSchedule: string;
  scanDay: string;
  scanHour: number;
  /** Day-of-month (1-28) for `monthly` cadence. Defaults to 1 if absent. */
  scanDayOfMonth?: number | null;
}

/**
 * Index 0 = Sunday (matches `Date.getUTCDay()`), index 1 = Monday, etc.
 * Lowercase per `ScanDaySchema` regex.
 */
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function matchesDay(day: string, now: Date): boolean {
  return DOW[now.getUTCDay()] === day.trim().toLowerCase();
}

/**
 * Returns `true` iff the org should be scanned at `now` (UTC) per its
 * `Settings`. Hour gate is checked first (cheap short-circuit).
 *
 * - `daily`   → fires on `scanHour` every day.
 * - `weekly`  → fires on `scanHour` on the single `scanDay`.
 * - `custom`  → fires on `scanHour` on any day in CSV `scanDay`.
 * - `monthly` → fires on `scanHour` when UTC day-of-month === `scanDayOfMonth ?? 1`.
 *
 * Unknown `scanSchedule` values return `false` (defensive — schema should
 * have rejected at write time).
 */
export function shouldScanNow(settings: CadenceSettings, now: Date): boolean {
  if (now.getUTCHours() !== settings.scanHour) return false;

  switch (settings.scanSchedule) {
    case 'daily':
      return true;
    case 'weekly':
      return matchesDay(settings.scanDay, now);
    case 'custom':
      return settings.scanDay.split(',').some((d) => matchesDay(d, now));
    case 'monthly':
      return now.getUTCDate() === (settings.scanDayOfMonth ?? 1);
    default:
      return false;
  }
}
