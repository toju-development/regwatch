/**
 * Component tests for `<UsageWidget>`.
 *
 * Spec: `sdd/scanner-vertical-ar/spec` § R-13-UsageWidget
 *   - S1 "Widget renders zero usage" → literal `"$0.00 / $10.00 (0%)"`.
 *   - S2 "Widget renders at-cap state" → `100%` + visible "cap reached"
 *     indicator.
 *
 * Design: `sdd/scanner-vertical-ar/design` § ADR-12
 *   - Tailwind colour buckets: green<70 / amber 70-90 / red ≥90 /
 *     blocked ≥100.
 *   - `Math.floor(percent)` for integer overlay (no fractional %).
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { UsageWidget } from '../usage-widget.js';
import type { UsageResponseDto } from '../types.js';

function buildUsage(over: Partial<UsageResponseDto['currentMonth']> = {}): UsageResponseDto {
  return {
    currentMonth: {
      tokensUsed: 0,
      costUsd: '0',
      scansCount: 0,
      capUsd: '10',
      percent: 0,
      monthStart: '2026-04-01T00:00:00.000Z',
      ...over,
    },
    isAtCap: false,
  };
}

describe('<UsageWidget>', () => {
  it('renders the literal "$0.00 / $10.00 (0%)" for a fresh org (R-13 S1)', () => {
    render(<UsageWidget usage={buildUsage()} />);

    // Spec scenario pins the literal string — strict match catches any
    // future drift (e.g. a stray decimal place or %-symbol change).
    const numbers = screen.getByTestId('usage-widget-numbers');
    expect(numbers.textContent).toBe('$0.00 / $10.00 (0%)');
    // No "cap reached" indicator at zero usage.
    expect(screen.queryByTestId('usage-widget-cap-reached')).toBeNull();
    // Progress track exists and reports 0 to ARIA consumers.
    const track = screen.getByTestId('usage-widget-progress-track');
    expect(track.getAttribute('aria-valuenow')).toBe('0');
  });

  it('formats Decimal-string costs with two decimals and floors percent (33.7 → "33%")', () => {
    render(
      <UsageWidget
        usage={buildUsage({
          costUsd: '3.37',
          // The apps/api helper returns integer-truncated percent; we
          // belt-and-suspenders the floor in the widget anyway so a
          // future helper change emitting fractions doesn't regress UI.
          percent: 33.7,
        })}
      />,
    );

    expect(screen.getByTestId('usage-widget-numbers').textContent).toBe('$3.37 / $10.00 (33%)');
    expect(screen.getByTestId('usage-widget-progress-track').getAttribute('aria-valuenow')).toBe(
      '33',
    );
  });

  it('renders "100%" + visible cap-reached indicator when isAtCap (R-13 S2)', () => {
    render(
      <UsageWidget
        usage={{
          currentMonth: {
            tokensUsed: 1_000_000,
            costUsd: '10',
            scansCount: 5,
            capUsd: '10',
            percent: 100,
            monthStart: '2026-04-01T00:00:00.000Z',
          },
          isAtCap: true,
        }}
      />,
    );

    expect(screen.getByTestId('usage-widget-numbers').textContent).toBe('$10.00 / $10.00 (100%)');
    const cap = screen.getByTestId('usage-widget-cap-reached');
    expect(cap.textContent).toMatch(/cap reached/i);
    expect(cap.getAttribute('role')).toBe('alert');
  });

  it('paints red-700 colour bucket at 100% and amber bucket at 70% (ADR-12)', () => {
    const { rerender } = render(
      <UsageWidget usage={buildUsage({ percent: 100, costUsd: '10' })} />,
    );
    let bar = screen.getByTestId('usage-widget-progress-bar');
    expect(bar.className).toMatch(/bg-red-700/);

    rerender(<UsageWidget usage={buildUsage({ percent: 70, costUsd: '7' })} />);
    bar = screen.getByTestId('usage-widget-progress-bar');
    expect(bar.className).toMatch(/bg-amber-500/);
  });

  it('clamps the visual width to [0,100] even if upstream percent leaks >100', () => {
    // Defense-in-depth: the apps/api DTO mapper clamps to [0,100], but if
    // ever a caller passes the un-clamped helper value, the bar must NOT
    // overflow visually. We assert width is exactly 100% in that path.
    render(<UsageWidget usage={buildUsage({ percent: 150 as number, costUsd: '15' })} />);
    const bar = screen.getByTestId('usage-widget-progress-bar');
    expect(bar.getAttribute('style')).toContain('width: 100%');
  });
});
