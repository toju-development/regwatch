/**
 * Unit tests for `<AssignedToMeList>`.
 *
 * sdd/dashboard-mvp/spec — web/dashboard domain.
 *   - VIEWER role → section is hidden (returns null).
 *   - ANALYST/ADMIN/OWNER with 0 assignments → empty state is shown (section visible).
 *   - ANALYST/ADMIN/OWNER with ≥1 assignments → list is rendered.
 *
 * NO `pnpm build` after changes (project rule).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// next/link renders as <a> in jsdom
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

import { AssignedToMeList } from '../assigned-to-me-list.js';
import type { Role } from '@regwatch/types';

const mockAlert = {
  id: 'alert-1',
  title: 'Test Alert',
  status: 'NEW' as const,
  severity: 'HIGH',
  detectedAt: '2026-01-01T00:00:00.000Z',
};

describe('<AssignedToMeList>', () => {
  it('VIEWER → section is hidden entirely (returns null)', () => {
    const { container } = render(<AssignedToMeList alerts={[mockAlert]} role={'VIEWER' as Role} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('assigned-to-me-section')).toBeNull();
  });

  it('VIEWER with empty alerts → also hidden', () => {
    const { container } = render(<AssignedToMeList alerts={[]} role={'VIEWER' as Role} />);
    expect(container.firstChild).toBeNull();
  });

  it('ANALYST with 0 assignments → section shown with empty state', () => {
    render(<AssignedToMeList alerts={[]} role={'ANALYST' as Role} />);

    expect(screen.getByTestId('assigned-to-me-section')).toBeInTheDocument();
    expect(screen.getByTestId('assigned-to-me-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('assigned-to-me-list')).toBeNull();
  });

  it('ADMIN with 0 assignments → section shown with empty state', () => {
    render(<AssignedToMeList alerts={[]} role={'ADMIN' as Role} />);

    expect(screen.getByTestId('assigned-to-me-section')).toBeInTheDocument();
    expect(screen.getByTestId('assigned-to-me-empty')).toBeInTheDocument();
  });

  it('OWNER with 0 assignments → section shown with empty state', () => {
    render(<AssignedToMeList alerts={[]} role={'OWNER' as Role} />);

    expect(screen.getByTestId('assigned-to-me-section')).toBeInTheDocument();
    expect(screen.getByTestId('assigned-to-me-empty')).toBeInTheDocument();
  });

  it('ANALYST with ≥1 assignment → list is rendered', () => {
    render(<AssignedToMeList alerts={[mockAlert]} role={'ANALYST' as Role} />);

    expect(screen.getByTestId('assigned-to-me-section')).toBeInTheDocument();
    expect(screen.getByTestId('assigned-to-me-list')).toBeInTheDocument();
    expect(screen.queryByTestId('assigned-to-me-empty')).toBeNull();
  });

  it('each assigned alert links to /alerts/[id]', () => {
    render(<AssignedToMeList alerts={[mockAlert]} role={'ANALYST' as Role} />);

    const link = screen.getByTestId('assigned-alert-alert-1');
    expect(link.getAttribute('href')).toBe('/alerts/alert-1');
  });

  it('renders alert title in the row', () => {
    render(
      <AssignedToMeList
        alerts={[{ ...mockAlert, title: 'My Assigned Alert' }]}
        role={'OWNER' as Role}
      />,
    );
    expect(screen.getByText('My Assigned Alert')).toBeInTheDocument();
  });
});
