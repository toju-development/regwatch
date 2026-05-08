/**
 * AlertStatsCards — grid of 4 stat cards for the dashboard.
 *
 * Spec: sdd/dashboard-mvp/spec — web/components domain.
 * Design: sdd/dashboard-mvp/design — pure RSC, accepts AlertStatsDto | null.
 *
 * When stats is null (fetch error), renders a visible error banner — NOT zeros.
 *
 * NO `pnpm build` after changes (project rule).
 */
import * as React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
// AlertStatsDto mirrors apps/api's dto — defined locally to keep web
// independent of apps/api types.
export interface AlertStatsDto {
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
  total: number;
}

interface StatCardProps {
  label: string;
  value: number;
  testId?: string;
}

function StatCard({ label, value, testId }: StatCardProps): React.ReactElement {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold" data-testid={testId}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

interface AlertStatsCardsProps {
  stats: AlertStatsDto | null;
  error?: boolean;
}

export function AlertStatsCards({ stats, error }: AlertStatsCardsProps): React.ReactElement {
  if (error || stats === null) {
    return (
      <div
        role="alert"
        className="bg-destructive/10 text-destructive rounded-md px-4 py-3 text-sm font-medium"
        data-testid="stats-error-banner"
      >
        Unable to load alert statistics. Please try refreshing the page.
      </div>
    );
  }

  const openCount =
    (stats.byStatus['NEW'] ?? 0) +
    (stats.byStatus['TRIAGING'] ?? 0) +
    (stats.byStatus['ANALYZING'] ?? 0) +
    (stats.byStatus['DEBATING'] ?? 0);

  const concludedCount = stats.byStatus['CONCLUDED'] ?? 0;

  const highCriticalCount = (stats.bySeverity['HIGH'] ?? 0) + (stats.bySeverity['CRITICAL'] ?? 0);

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4" data-testid="stats-cards">
      <StatCard label="Total Alerts" value={stats.total} testId="stat-total" />
      <StatCard label="Open" value={openCount} testId="stat-open" />
      <StatCard label="Concluded" value={concludedCount} testId="stat-concluded" />
      <StatCard label="High / Critical" value={highCriticalCount} testId="stat-high-critical" />
    </div>
  );
}
