/**
 * RecentAlertsList — renders the last 10 alerts for the dashboard.
 *
 * Spec: sdd/dashboard-mvp/spec — web/dashboard domain.
 * Design: pure RSC, accepts AlertListItem[]; each row links to /alerts/[id].
 *
 * NO `pnpm build` after changes (project rule).
 */
import * as React from 'react';
import Link from 'next/link';
import type { AlertStatus } from '@regwatch/types';
import { AlertStatusBadge } from '@/components/ui/alert-status-badge';

export interface AlertListItem {
  id: string;
  title: string;
  status: AlertStatus;
  severity: string;
  source: string;
  detectedAt: string;
  assignee: { id: string; name: string | null; email: string } | null;
}

interface RecentAlertsListProps {
  alerts: AlertListItem[];
}

export function RecentAlertsList({ alerts }: RecentAlertsListProps): React.ReactElement {
  if (alerts.length === 0) {
    return (
      <p className="text-muted-foreground text-sm" data-testid="recent-alerts-empty">
        No recent alerts.
      </p>
    );
  }

  return (
    <ul className="divide-border divide-y" data-testid="recent-alerts-list">
      {alerts.map((alert) => (
        <li key={alert.id}>
          <Link
            href={`/alerts/${alert.id}`}
            className="hover:bg-muted/50 flex items-center justify-between px-2 py-3 text-sm transition-colors"
            data-testid={`recent-alert-${alert.id}`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{alert.title}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {alert.severity} · {alert.source} ·{' '}
                {new Date(alert.detectedAt).toLocaleDateString()}
                {alert.assignee && <> · {alert.assignee.name ?? alert.assignee.email}</>}
              </p>
            </div>
            <AlertStatusBadge status={alert.status} className="ml-4 shrink-0" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
