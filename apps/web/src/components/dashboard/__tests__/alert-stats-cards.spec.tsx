/**
 * Unit tests for `<AlertStatsCards>`.
 *
 * sdd/dashboard-mvp/spec — web/components domain.
 *   - Renders 4 stat cards (Total, Open, Concluded, High/Critical) from stats.
 *   - Computes Open = NEW + TRIAGING + ANALYZING + DEBATING.
 *   - Computes High/Critical = HIGH + CRITICAL counts.
 *   - Renders visible error banner (NOT zeros) when stats=null.
 *
 * NO `pnpm build` after changes (project rule).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlertStatsCards } from '../alert-stats-cards.js';
import type { AlertStatsDto } from '../alert-stats-cards.js';

function buildStats(over: Partial<AlertStatsDto> = {}): AlertStatsDto {
  return {
    byStatus: {},
    bySeverity: {},
    total: 0,
    ...over,
  };
}

describe('<AlertStatsCards>', () => {
  it('renders error banner when stats is null (not zeros)', () => {
    render(<AlertStatsCards stats={null} />);

    expect(screen.getByTestId('stats-error-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('stats-cards')).toBeNull();
  });

  it('renders error banner when error=true even with valid stats', () => {
    render(<AlertStatsCards stats={buildStats({ total: 5 })} error={true} />);

    expect(screen.getByTestId('stats-error-banner')).toBeInTheDocument();
  });

  it('renders 4 stat cards when stats is provided', () => {
    render(<AlertStatsCards stats={buildStats()} />);

    expect(screen.getByTestId('stats-cards')).toBeInTheDocument();
    expect(screen.getByTestId('stat-total')).toBeInTheDocument();
    expect(screen.getByTestId('stat-open')).toBeInTheDocument();
    expect(screen.getByTestId('stat-concluded')).toBeInTheDocument();
    expect(screen.getByTestId('stat-high-critical')).toBeInTheDocument();
  });

  it('displays total count correctly', () => {
    render(<AlertStatsCards stats={buildStats({ total: 42 })} />);
    expect(screen.getByTestId('stat-total').textContent).toBe('42');
  });

  it('computes Open = NEW + TRIAGING + ANALYZING + DEBATING', () => {
    render(
      <AlertStatsCards
        stats={buildStats({
          byStatus: { NEW: 3, TRIAGING: 2, ANALYZING: 1, DEBATING: 1, CONCLUDED: 5 },
          total: 12,
        })}
      />,
    );
    // Open = 3 + 2 + 1 + 1 = 7
    expect(screen.getByTestId('stat-open').textContent).toBe('7');
  });

  it('computes Concluded from byStatus.CONCLUDED', () => {
    render(
      <AlertStatsCards
        stats={buildStats({
          byStatus: { CONCLUDED: 8 },
          total: 8,
        })}
      />,
    );
    expect(screen.getByTestId('stat-concluded').textContent).toBe('8');
  });

  it('computes High/Critical = HIGH + CRITICAL', () => {
    render(
      <AlertStatsCards
        stats={buildStats({
          bySeverity: { HIGH: 4, CRITICAL: 2, LOW: 10 },
          total: 16,
        })}
      />,
    );
    expect(screen.getByTestId('stat-high-critical').textContent).toBe('6');
  });

  it('all-zero org → all cards show 0', () => {
    render(<AlertStatsCards stats={buildStats({ total: 0 })} />);

    expect(screen.getByTestId('stat-total').textContent).toBe('0');
    expect(screen.getByTestId('stat-open').textContent).toBe('0');
    expect(screen.getByTestId('stat-concluded').textContent).toBe('0');
    expect(screen.getByTestId('stat-high-critical').textContent).toBe('0');
  });

  it('error banner has role="alert" for accessibility', () => {
    render(<AlertStatsCards stats={null} />);
    const banner = screen.getByTestId('stats-error-banner');
    expect(banner.getAttribute('role')).toBe('alert');
  });
});
