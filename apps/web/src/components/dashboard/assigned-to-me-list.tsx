/**
 * AssignedToMeList — shows alerts assigned to the current user.
 *
 * Spec: sdd/dashboard-mvp/spec — web/dashboard domain.
 *   - VIEWER role: section is hidden entirely.
 *   - ANALYST/ADMIN/OWNER with 0 assignments: empty state shown.
 *   - ANALYST/ADMIN/OWNER with ≥1 assignment: up to 5 alerts listed.
 *
 * Design: pure RSC.
 *
 * NO `pnpm build` after changes (project rule).
 */
import * as React from 'react';
import Link from 'next/link';
import type { AlertStatus, Role } from '@regwatch/types';
import { AlertStatusBadge } from '@/components/ui/alert-status-badge';

interface AssignedAlertItem {
  id: string;
  title: string;
  status: AlertStatus;
  severity: string;
  detectedAt: string;
}

interface AssignedToMeListProps {
  alerts: AssignedAlertItem[];
  role: Role;
}

export function AssignedToMeList({
  alerts,
  role,
}: AssignedToMeListProps): React.ReactElement | null {
  // VIEWER: hide the section entirely
  if (role === 'VIEWER') {
    return null;
  }

  return (
    <section data-testid="assigned-to-me-section">
      <h2 className="mb-3 text-lg font-semibold">Assigned to me</h2>

      {alerts.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="assigned-to-me-empty">
          No alerts assigned to you.
        </p>
      ) : (
        <ul className="divide-border divide-y" data-testid="assigned-to-me-list">
          {alerts.map((alert) => (
            <li key={alert.id}>
              <Link
                href={`/alerts/${alert.id}`}
                className="hover:bg-muted/50 flex items-center justify-between px-2 py-3 text-sm transition-colors"
                data-testid={`assigned-alert-${alert.id}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{alert.title}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {alert.severity} · {new Date(alert.detectedAt).toLocaleDateString()}
                  </p>
                </div>
                <AlertStatusBadge status={alert.status} className="ml-4 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
