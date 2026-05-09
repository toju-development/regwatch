/**
 * AlertStatusBadge — reusable status pill extracted from alerts/page.tsx.
 * sdd/dashboard-mvp/spec — web/components domain.
 *
 * Renders a status-coloured inline badge for any AlertStatus value.
 * Used on both /dashboard (RecentAlertsList) and /alerts (AlertsPage).
 */
import * as React from 'react';
import { cn } from '@/lib/utils';
import type { AlertStatus } from '@regwatch/types';

export const STATUS_BADGE: Record<AlertStatus, string> = {
  NEW: 'bg-blue-100 text-blue-800',
  TRIAGING: 'bg-yellow-100 text-yellow-800',
  ANALYZING: 'bg-orange-100 text-orange-800',
  DEBATING: 'bg-purple-100 text-purple-800',
  CONCLUDED: 'bg-green-100 text-green-800',
  DISTRIBUTED: 'bg-gray-100 text-gray-800',
  ARCHIVED: 'bg-gray-100 text-gray-500',
};

interface AlertStatusBadgeProps {
  status: AlertStatus;
  className?: string;
}

export function AlertStatusBadge({ status, className }: AlertStatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        STATUS_BADGE[status],
        className,
      )}
    >
      {status}
    </span>
  );
}
