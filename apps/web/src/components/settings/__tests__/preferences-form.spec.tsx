/**
 * Component tests for `<PreferencesForm>`.
 *
 * Spec: `sdd/jurisdictions-config/spec` § R-Settings-Preferences-Page
 *   - "Page renders current settings" (form mounts with initial values).
 *   - "ANALYST cannot submit" (submit disabled when canEdit=false).
 *   - "Validation error surfaces inline" (server-action fieldErrors map
 *     renders next to the offending field).
 *
 * Mocks:
 *   - `./actions` (server action).
 *   - `next-auth/react` `useSession` (the form calls `update({})` on
 *     STALE; we just need a stub).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS, JURISDICTIONS } from '@regwatch/types';

const updateSettingsAction = vi.fn();
const sessionUpdate = vi.fn();

vi.mock('../actions.js', () => ({
  updateSettingsAction: (...a: unknown[]) => updateSettingsAction(...a),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ update: sessionUpdate, data: null, status: 'authenticated' }),
}));

import { PreferencesForm } from '../preferences-form.js';

beforeEach(() => {
  updateSettingsAction.mockReset();
  sessionUpdate.mockReset();
});

afterEach(() => {
  // no-op
});

describe('<PreferencesForm>', () => {
  it('renders all 9 jurisdictions seeded from initial values', () => {
    render(
      <PreferencesForm
        orgId="org-1"
        canEdit
        initial={{
          jurisdictions: DEFAULT_SETTINGS.jurisdictions,
          scanSchedule: DEFAULT_SETTINGS.scanSchedule,
          scanDay: DEFAULT_SETTINGS.scanDay,
          scanHour: DEFAULT_SETTINGS.scanHour,
        }}
      />,
    );

    for (const j of JURISDICTIONS) {
      const checkbox = screen.getByTestId(
        `preferences-form-jurisdiction-${j.code}-enabled`,
      ) as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    }
    expect((screen.getByTestId('preferences-form-schedule') as HTMLSelectElement).value).toBe(
      'weekly',
    );
    expect((screen.getByTestId('preferences-form-day-weekly') as HTMLSelectElement).value).toBe(
      'mon',
    );
  });

  it('disables submit and inputs when canEdit=false', () => {
    render(
      <PreferencesForm
        orgId="org-1"
        canEdit={false}
        initial={{
          jurisdictions: DEFAULT_SETTINGS.jurisdictions,
          scanSchedule: DEFAULT_SETTINGS.scanSchedule,
          scanDay: DEFAULT_SETTINGS.scanDay,
          scanHour: DEFAULT_SETTINGS.scanHour,
        }}
      />,
    );

    const submit = screen.getByTestId('preferences-form-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByTestId('preferences-form-readonly-hint')).toBeTruthy();
    // Fieldsets disabled cascades to inputs.
    const fs = screen.getByTestId('preferences-form-jurisdictions') as HTMLFieldSetElement;
    expect(fs.disabled).toBe(true);
  });

  it('submits the full payload on save and shows success', async () => {
    updateSettingsAction.mockResolvedValue({ ok: true });

    render(
      <PreferencesForm
        orgId="org-1"
        canEdit
        initial={{
          jurisdictions: DEFAULT_SETTINGS.jurisdictions,
          scanSchedule: DEFAULT_SETTINGS.scanSchedule,
          scanDay: DEFAULT_SETTINGS.scanDay,
          scanHour: DEFAULT_SETTINGS.scanHour,
        }}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId('preferences-form-submit'));

    await waitFor(() => expect(updateSettingsAction).toHaveBeenCalledTimes(1));
    const [orgId, payload] = updateSettingsAction.mock.calls[0]!;
    expect(orgId).toBe('org-1');
    expect(payload).toMatchObject({
      scanSchedule: 'weekly',
      scanDay: 'mon',
      scanHour: 8,
    });
    expect((payload as { jurisdictions: unknown[] }).jurisdictions).toHaveLength(9);
    await screen.findByTestId('preferences-form-success');
  });

  it('surfaces server fieldErrors inline next to the offending field', async () => {
    updateSettingsAction.mockResolvedValue({
      ok: false,
      code: 'VALIDATION',
      error: 'Invalid',
      fieldErrors: { scanHour: ['INVALID_HOUR'] },
    });

    render(
      <PreferencesForm
        orgId="org-1"
        canEdit
        initial={{
          jurisdictions: DEFAULT_SETTINGS.jurisdictions,
          scanSchedule: DEFAULT_SETTINGS.scanSchedule,
          scanDay: DEFAULT_SETTINGS.scanDay,
          scanHour: DEFAULT_SETTINGS.scanHour,
        }}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId('preferences-form-submit'));

    const err = await screen.findByTestId('preferences-form-scan-hour-error');
    expect(err.textContent).toMatch(/INVALID_HOUR/);
  });

  it('switches schedule to daily and HIDES the day picker', async () => {
    render(
      <PreferencesForm
        orgId="org-1"
        canEdit
        initial={{
          jurisdictions: DEFAULT_SETTINGS.jurisdictions,
          scanSchedule: DEFAULT_SETTINGS.scanSchedule,
          scanDay: DEFAULT_SETTINGS.scanDay,
          scanHour: DEFAULT_SETTINGS.scanHour,
        }}
      />,
    );

    const user = userEvent.setup();
    expect(screen.queryByTestId('preferences-form-day-weekly')).not.toBeNull();

    const select = screen.getByTestId('preferences-form-schedule');
    await user.selectOptions(select, 'daily');

    expect(screen.queryByTestId('preferences-form-day-weekly')).toBeNull();
    expect(screen.queryByTestId('preferences-form-day-custom-wrap')).toBeNull();
  });

  it('renders custom multi-day picker when schedule=custom', async () => {
    render(
      <PreferencesForm
        orgId="org-1"
        canEdit
        initial={{
          jurisdictions: DEFAULT_SETTINGS.jurisdictions,
          scanSchedule: 'custom',
          scanDay: 'mon,wed,fri',
          scanHour: DEFAULT_SETTINGS.scanHour,
        }}
      />,
    );

    const wrap = screen.getByTestId('preferences-form-day-custom-wrap');
    expect(
      (within(wrap).getByTestId('preferences-form-day-custom-mon') as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (within(wrap).getByTestId('preferences-form-day-custom-wed') as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (within(wrap).getByTestId('preferences-form-day-custom-fri') as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (within(wrap).getByTestId('preferences-form-day-custom-tue') as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('shows day-of-month input when schedule=monthly', async () => {
    render(
      <PreferencesForm
        orgId="org-1"
        canEdit
        initial={{
          jurisdictions: DEFAULT_SETTINGS.jurisdictions,
          scanSchedule: DEFAULT_SETTINGS.scanSchedule,
          scanDay: DEFAULT_SETTINGS.scanDay,
          scanHour: DEFAULT_SETTINGS.scanHour,
        }}
      />,
    );

    const user = userEvent.setup();
    const select = screen.getByTestId('preferences-form-schedule');

    // monthly not yet selected — input should be absent
    expect(screen.queryByTestId('preferences-form-day-of-month')).toBeNull();

    await user.selectOptions(select, 'monthly');

    const dayInput = screen.getByTestId('preferences-form-day-of-month') as HTMLInputElement;
    expect(dayInput).toBeTruthy();
    expect(dayInput.min).toBe('1');
    expect(dayInput.max).toBe('28');
  });

  it('hides day-of-month input when switching away from monthly', async () => {
    render(
      <PreferencesForm
        orgId="org-1"
        canEdit
        initial={{
          jurisdictions: DEFAULT_SETTINGS.jurisdictions,
          scanSchedule: 'monthly',
          scanDay: DEFAULT_SETTINGS.scanDay,
          scanHour: DEFAULT_SETTINGS.scanHour,
          scanDayOfMonth: 15,
        }}
      />,
    );

    expect(screen.getByTestId('preferences-form-day-of-month')).toBeTruthy();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByTestId('preferences-form-schedule'), 'weekly');

    expect(screen.queryByTestId('preferences-form-day-of-month')).toBeNull();
  });

  it('includes scanDayOfMonth in payload when schedule=monthly', async () => {
    updateSettingsAction.mockResolvedValue({ ok: true });

    render(
      <PreferencesForm
        orgId="org-1"
        canEdit
        initial={{
          jurisdictions: DEFAULT_SETTINGS.jurisdictions,
          scanSchedule: 'monthly',
          scanDay: DEFAULT_SETTINGS.scanDay,
          scanHour: DEFAULT_SETTINGS.scanHour,
          scanDayOfMonth: 15,
        }}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId('preferences-form-submit'));

    await waitFor(() => expect(updateSettingsAction).toHaveBeenCalledTimes(1));
    const [, payload] = updateSettingsAction.mock.calls[0]!;
    expect((payload as { scanSchedule: string }).scanSchedule).toBe('monthly');
    expect((payload as { scanDayOfMonth: number }).scanDayOfMonth).toBe(15);
  });
});
