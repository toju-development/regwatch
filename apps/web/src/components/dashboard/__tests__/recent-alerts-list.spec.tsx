/**
 * Unit tests for `<RecentAlertsList>`.
 *
 * sdd/dashboard-mvp/spec — web/dashboard domain.
 *   - Empty alerts array → renders empty state message.
 *   - Non-empty alerts → renders list with links to /alerts/[id].
 *   - Each row shows title, severity, source, assignee info.
 *
 * NO `pnpm build` after changes (project rule).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// next/link renders as <a> in jsdom; mock to keep tests simple
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { RecentAlertsList } from '../recent-alerts-list.js';
import type { AlertListItem } from '../recent-alerts-list.js';

function buildAlert(over: Partial<AlertListItem> = {}): AlertListItem {
  return {
    id: 'alert-1',
    title: 'Test Alert',
    status: 'NEW',
    severity: 'HIGH',
    source: 'MANUAL',
    detectedAt: '2026-01-01T00:00:00.000Z',
    assignee: null,
    ...over,
  };
}

describe('<RecentAlertsList>', () => {
  it('renders empty state message when alerts array is empty', () => {
    render(<RecentAlertsList alerts={[]} />);

    expect(screen.getByTestId('recent-alerts-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('recent-alerts-list')).toBeNull();
  });

  it('renders list when alerts are provided', () => {
    const alerts = [buildAlert({ id: 'a1' }), buildAlert({ id: 'a2', title: 'Second Alert' })];
    render(<RecentAlertsList alerts={alerts} />);

    expect(screen.getByTestId('recent-alerts-list')).toBeInTheDocument();
    expect(screen.queryByTestId('recent-alerts-empty')).toBeNull();
  });

  it('each alert row links to /alerts/[id]', () => {
    render(<RecentAlertsList alerts={[buildAlert({ id: 'abc-123' })]} />);

    const link = screen.getByTestId('recent-alert-abc-123');
    expect(link.getAttribute('href')).toBe('/alerts/abc-123');
  });

  it('renders alert title in each row', () => {
    render(<RecentAlertsList alerts={[buildAlert({ title: 'FCA Regulation Update' })]} />);

    expect(screen.getByText('FCA Regulation Update')).toBeInTheDocument();
  });

  it('renders severity and source in the row metadata', () => {
    render(<RecentAlertsList alerts={[buildAlert({ severity: 'CRITICAL', source: 'RSS' })]} />);

    expect(screen.getByText(/CRITICAL/)).toBeInTheDocument();
    expect(screen.getByText(/RSS/)).toBeInTheDocument();
  });

  it('renders assignee name when assignee is present', () => {
    render(
      <RecentAlertsList
        alerts={[buildAlert({ assignee: { id: 'u1', name: 'Alice', email: 'alice@x.com' } })]}
      />,
    );
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it('renders assignee email when name is null', () => {
    render(
      <RecentAlertsList
        alerts={[buildAlert({ assignee: { id: 'u1', name: null, email: 'bob@x.com' } })]}
      />,
    );
    expect(screen.getByText(/bob@x.com/)).toBeInTheDocument();
  });

  it('does not render assignee info when assignee is null', () => {
    render(<RecentAlertsList alerts={[buildAlert({ assignee: null })]} />);
    expect(screen.queryByText(/@/)).toBeNull();
  });
});
