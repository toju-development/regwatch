/**
 * `<PreferencesForm>` — client form for `/settings/preferences`.
 *
 * Spec: `sdd/jurisdictions-config/spec`
 *   - R-Settings-Preferences-Page (Page renders current settings;
 *     OWNER edits and saves; ANALYST cannot submit; Validation error
 *     surfaces inline).
 *
 * Design: `sdd/jurisdictions-config/design`
 *   - §6 (frontend integration). Checkbox group for the 7 jurisdictions
 *     + free-text customTopics input per row + selects for cadence
 *     (`scanSchedule`, `scanDay` conditional, `scanHour`).
 *   - §0 D11 (full-replace PUT — we send the WHOLE state on submit, not
 *     a partial PATCH).
 *
 * No `Checkbox`/`Select`/`Input`/`Label` primitive in `components/ui/`
 * yet — using native form elements styled with Tailwind, mirroring
 * `<InviteMemberForm>`'s native `<input>` posture. When shadcn primitives
 * arrive, swap one-to-one (no API change).
 *
 * Cadence rules (mirror `UpdateSettingsSchema.superRefine`):
 *   - `daily`  → `scanDay` field is HIDDEN (server normalises on save).
 *   - `weekly` → exactly ONE day picker (radio-style select).
 *   - `custom` → multi-select day picker (checkboxes serialised to CSV).
 *
 * STALE_MEMBERSHIPS surface: the server action returns the code; this
 * component reacts by calling `useSession().update({})` then triggers a
 * single retry (mirrors the client `apiFetch` STALE retry contract).
 */
'use client';

import { useState, useTransition } from 'react';
import { useSession } from 'next-auth/react';
import {
  JURISDICTIONS,
  type JurisdictionCode,
  type SettingsJurisdictions,
  type SettingsJurisdiction,
  type ScanSchedule,
} from '@regwatch/types';

import { Button } from '@/components/ui/button';

import { updateSettingsAction, type UpdateSettingsResult } from './actions';

const SCHEDULE_OPTIONS: ReadonlyArray<ScanSchedule> = ['daily', 'weekly', 'custom'];
const DAYS_OF_WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type DayOfWeek = (typeof DAYS_OF_WEEK)[number];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export interface PreferencesFormInitial {
  jurisdictions: SettingsJurisdictions;
  scanSchedule: ScanSchedule;
  scanDay: string;
  scanHour: number;
}

export interface PreferencesFormProps {
  /** Org under which to update settings (also used as `X-Org-Id`). */
  orgId: string;
  /**
   * Viewer permitted to mutate (OWNER + ADMIN). When `false` the form
   * still renders all current values but the submit + inputs are
   * disabled — UI defense-in-depth, the server is the source of truth.
   */
  canEdit: boolean;
  /** Current persisted state; seeds the local React state on mount. */
  initial: PreferencesFormInitial;
}

/**
 * Build a `SettingsJurisdictions` array in the canonical 7-LatAm order
 * (per `JURISDICTIONS` registry) by merging an incoming partial map
 * with defaults. Guarantees we always submit all 7 codes, no dups.
 */
function normaliseJurisdictions(
  rows: ReadonlyMap<JurisdictionCode, SettingsJurisdiction>,
): SettingsJurisdictions {
  return JURISDICTIONS.map(
    (j) =>
      rows.get(j.code) ?? {
        code: j.code,
        enabled: false,
        customTopics: '',
      },
  );
}

function describeError(result: UpdateSettingsResult): string {
  if (result.error) return result.error;
  switch (result.code) {
    case 'STALE_MEMBERSHIPS':
      return 'Your session was refreshed. Please retry.';
    case 'FORBIDDEN':
      return 'You do not have permission to change settings.';
    case 'VALIDATION':
      return 'Some fields are invalid. Fix them and try again.';
    case 'UNAUTHENTICATED':
      return 'You are signed out. Please sign in and retry.';
    case 'NOT_FOUND':
      return 'Organization not found.';
    default:
      return 'Failed to save preferences.';
  }
}

export function PreferencesForm({
  orgId,
  canEdit,
  initial,
}: PreferencesFormProps): React.ReactElement {
  // Index initial jurisdictions by code so we can edit individual rows
  // without reordering. Re-serialised in canonical order on submit.
  const [rows, setRows] = useState<Map<JurisdictionCode, SettingsJurisdiction>>(() => {
    const m = new Map<JurisdictionCode, SettingsJurisdiction>();
    for (const j of initial.jurisdictions) {
      m.set(j.code as JurisdictionCode, j);
    }
    return m;
  });
  const [scanSchedule, setScanSchedule] = useState<ScanSchedule>(initial.scanSchedule);
  const [scanDay, setScanDay] = useState<string>(initial.scanDay);
  const [scanHour, setScanHour] = useState<number>(initial.scanHour);
  const [pending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const { update: updateSession } = useSession();

  // For 'custom' the day picker is multi-select (CSV). Parse the current
  // state into a Set for the checked-state check.
  const customDays = new Set(scanDay.split(',').filter(Boolean));

  function setRow(code: JurisdictionCode, patch: Partial<SettingsJurisdiction>): void {
    setRows((prev) => {
      const next = new Map(prev);
      const current = prev.get(code) ?? { code, enabled: false, customTopics: '' };
      next.set(code, { ...current, ...patch });
      return next;
    });
  }

  function handleScheduleChange(next: ScanSchedule): void {
    setScanSchedule(next);
    // Normalise scanDay to a sane default whenever the schedule changes
    // so the user can't get into an invalid `weekly` + CSV state.
    if (next === 'weekly' && scanDay.includes(',')) {
      setScanDay('mon');
    }
  }

  function toggleCustomDay(day: DayOfWeek): void {
    const next = new Set(customDays);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    setScanDay(
      DAYS_OF_WEEK.filter((d) => next.has(d))
        .join(',')
        .trim(),
    );
  }

  async function submitOnce(): Promise<UpdateSettingsResult> {
    return await updateSettingsAction(orgId, {
      jurisdictions: normaliseJurisdictions(rows),
      scanSchedule,
      scanDay,
      scanHour,
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canEdit) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setFieldErrors({});
    startTransition(async () => {
      let result = await submitOnce();
      // STALE_MEMBERSHIPS: refresh the JWT then retry ONCE (mirrors the
      // client `apiFetch` retry budget).
      if (!result.ok && result.code === 'STALE_MEMBERSHIPS') {
        try {
          await updateSession({});
        } catch {
          /* swallow — the retry below will surface the real error */
        }
        result = await submitOnce();
      }
      if (!result.ok) {
        setErrorMsg(describeError(result));
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        return;
      }
      setSuccessMsg('Preferences saved.');
    });
  }

  const formDisabled = pending || !canEdit;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-6"
      data-testid="preferences-form"
      aria-disabled={formDisabled || undefined}
    >
      <fieldset
        className="flex flex-col gap-3 rounded-md border p-4"
        data-testid="preferences-form-jurisdictions"
        disabled={formDisabled}
      >
        <legend className="px-1 text-sm font-medium">Jurisdictions</legend>
        <p className="text-muted-foreground text-xs">
          Select countries the scanner should monitor. Add comma-separated topics per country to
          narrow the scope.
        </p>
        <ul className="flex flex-col gap-2">
          {JURISDICTIONS.map((j) => {
            const row = rows.get(j.code) ?? {
              code: j.code,
              enabled: false,
              customTopics: '',
            };
            return (
              <li
                key={j.code}
                className="flex flex-col gap-2 sm:flex-row sm:items-center"
                data-testid={`preferences-form-jurisdiction-row-${j.code}`}
              >
                <label className="flex min-w-[10rem] items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(e) => setRow(j.code, { enabled: e.target.checked })}
                    data-testid={`preferences-form-jurisdiction-${j.code}-enabled`}
                  />
                  <span className="font-medium">{j.code}</span>
                  <span className="text-muted-foreground">{j.name}</span>
                </label>
                <input
                  type="text"
                  value={row.customTopics}
                  onChange={(e) => setRow(j.code, { customTopics: e.target.value })}
                  placeholder="e.g. fintech, datos personales"
                  className="border-input bg-background flex-1 rounded-md border px-3 py-2 text-sm"
                  data-testid={`preferences-form-jurisdiction-${j.code}-topics`}
                />
              </li>
            );
          })}
        </ul>
        {fieldErrors.jurisdictions ? (
          <p
            role="alert"
            className="text-destructive text-xs"
            data-testid="preferences-form-jurisdictions-error"
          >
            {fieldErrors.jurisdictions.join(' ')}
          </p>
        ) : null}
      </fieldset>

      <fieldset
        className="flex flex-col gap-3 rounded-md border p-4"
        data-testid="preferences-form-cadence"
        disabled={formDisabled}
      >
        <legend className="px-1 text-sm font-medium">Scan cadence</legend>

        <div className="flex flex-col gap-1">
          <label htmlFor="preferences-form-schedule" className="text-sm font-medium">
            Schedule
          </label>
          <select
            id="preferences-form-schedule"
            value={scanSchedule}
            onChange={(e) => handleScheduleChange(e.target.value as ScanSchedule)}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm sm:max-w-xs"
            data-testid="preferences-form-schedule"
          >
            {SCHEDULE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {scanSchedule === 'weekly' ? (
          <div className="flex flex-col gap-1" data-testid="preferences-form-day-weekly-wrap">
            <label htmlFor="preferences-form-day-weekly" className="text-sm font-medium">
              Day of week
            </label>
            <select
              id="preferences-form-day-weekly"
              value={DAYS_OF_WEEK.includes(scanDay as DayOfWeek) ? scanDay : 'mon'}
              onChange={(e) => setScanDay(e.target.value)}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm sm:max-w-xs"
              data-testid="preferences-form-day-weekly"
            >
              {DAYS_OF_WEEK.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {scanSchedule === 'custom' ? (
          <div className="flex flex-col gap-1" data-testid="preferences-form-day-custom-wrap">
            <span className="text-sm font-medium">Days of week</span>
            <div className="flex flex-wrap gap-3">
              {DAYS_OF_WEEK.map((d) => (
                <label key={d} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={customDays.has(d)}
                    onChange={() => toggleCustomDay(d)}
                    data-testid={`preferences-form-day-custom-${d}`}
                  />
                  {d}
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {fieldErrors.scanDay ? (
          <p
            role="alert"
            className="text-destructive text-xs"
            data-testid="preferences-form-scan-day-error"
          >
            {fieldErrors.scanDay.join(' ')}
          </p>
        ) : null}

        <div className="flex flex-col gap-1">
          <label htmlFor="preferences-form-hour" className="text-sm font-medium">
            Hour (0–23, server time)
          </label>
          <select
            id="preferences-form-hour"
            value={scanHour}
            onChange={(e) => setScanHour(Number.parseInt(e.target.value, 10))}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm sm:max-w-xs"
            data-testid="preferences-form-hour"
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h.toString().padStart(2, '0')}:00
              </option>
            ))}
          </select>
          {fieldErrors.scanHour ? (
            <p
              role="alert"
              className="text-destructive text-xs"
              data-testid="preferences-form-scan-hour-error"
            >
              {fieldErrors.scanHour.join(' ')}
            </p>
          ) : null}
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={formDisabled} data-testid="preferences-form-submit">
          {pending ? 'Saving…' : 'Save preferences'}
        </Button>
        {!canEdit ? (
          <span
            className="text-muted-foreground text-xs"
            data-testid="preferences-form-readonly-hint"
          >
            Only OWNER and ADMIN can change preferences.
          </span>
        ) : null}
      </div>

      {errorMsg ? (
        <p role="alert" className="text-destructive text-sm" data-testid="preferences-form-error">
          {errorMsg}
        </p>
      ) : null}
      {successMsg ? (
        <p
          role="status"
          className="text-muted-foreground text-sm"
          data-testid="preferences-form-success"
        >
          {successMsg}
        </p>
      ) : null}
    </form>
  );
}
