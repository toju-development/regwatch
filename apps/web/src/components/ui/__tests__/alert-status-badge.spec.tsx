/**
 * Unit tests for `<AlertStatusBadge>`.
 *
 * Covers all 7 alert statuses: NEW, TRIAGING, ANALYZING, DEBATING,
 * CONCLUDED, DISTRIBUTED, ARCHIVED.
 *
 * Verifies that each renders the correct label text and applies the
 * expected CSS classes from STATUS_BADGE.
 *
 * NO `pnpm build` after changes (project rule).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlertStatusBadge, STATUS_BADGE } from '../alert-status-badge.js';
import type { AlertStatus } from '@regwatch/types';

const ALL_STATUSES: AlertStatus[] = [
  'NEW',
  'TRIAGING',
  'ANALYZING',
  'DEBATING',
  'CONCLUDED',
  'DISTRIBUTED',
  'ARCHIVED',
];

describe('AlertStatusBadge', () => {
  it.each(ALL_STATUSES)('%s: renders the status label', (status) => {
    render(<AlertStatusBadge status={status} />);
    expect(screen.getByText(status)).toBeInTheDocument();
  });

  it.each(ALL_STATUSES)('%s: applies the expected CSS classes', (status) => {
    render(<AlertStatusBadge status={status} />);
    const badge = screen.getByText(status);
    const expected = STATUS_BADGE[status].split(' ');
    for (const cls of expected) {
      expect(badge.classList.contains(cls)).toBe(true);
    }
  });

  it('NEW has blue colour classes', () => {
    render(<AlertStatusBadge status="NEW" />);
    const badge = screen.getByText('NEW');
    expect(badge.classList.contains('bg-blue-100')).toBe(true);
    expect(badge.classList.contains('text-blue-800')).toBe(true);
  });

  it('TRIAGING has yellow colour classes', () => {
    render(<AlertStatusBadge status="TRIAGING" />);
    const badge = screen.getByText('TRIAGING');
    expect(badge.classList.contains('bg-yellow-100')).toBe(true);
    expect(badge.classList.contains('text-yellow-800')).toBe(true);
  });

  it('CONCLUDED has green colour classes', () => {
    render(<AlertStatusBadge status="CONCLUDED" />);
    const badge = screen.getByText('CONCLUDED');
    expect(badge.classList.contains('bg-green-100')).toBe(true);
    expect(badge.classList.contains('text-green-800')).toBe(true);
  });

  it('ARCHIVED has gray text-gray-500 class', () => {
    render(<AlertStatusBadge status="ARCHIVED" />);
    const badge = screen.getByText('ARCHIVED');
    expect(badge.classList.contains('text-gray-500')).toBe(true);
  });

  it('accepts an extra className and applies it', () => {
    render(<AlertStatusBadge status="NEW" className="extra-class" />);
    const badge = screen.getByText('NEW');
    expect(badge.classList.contains('extra-class')).toBe(true);
  });
});
