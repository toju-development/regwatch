/**
 * `/alerts` — Alert list page with status and assignee filters.
 *
 * Spec: sdd/alert-collaboration/spec — web-alerts domain.
 *   - Status filter: dropdown of AlertStatus values
 *   - AssigneeId filter: text input (free-form — no member list call needed for MVP)
 *   - Pagination: "Load more" via cursor
 *
 * Design: client component (needs activeOrgId from Zustand store).
 * Uses apiFetch → /api/alerts proxy → apps/api GET /alerts.
 *
 * NO `pnpm build` after changes (project rule).
 */
'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { useActiveOrg } from '@/lib/active-org-store';
import { apiFetch } from '@/lib/api-fetch';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { AlertStatus, CursorPage } from '@regwatch/types';
import { ALERT_STATUS_VALUES } from '@regwatch/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AlertListItem {
  id: string;
  title: string;
  status: AlertStatus;
  severity: string;
  source: string;
  detectedAt: string;
  enrichmentStatus: string;
  assigneeId: string | null;
  assignee: { id: string; name: string | null; email: string } | null;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const inputCls =
  'block w-full rounded-md border border-input bg-background px-3 py-2 text-sm ' +
  'placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const STATUS_BADGE: Record<AlertStatus, string> = {
  NEW: 'bg-blue-100 text-blue-800',
  TRIAGING: 'bg-yellow-100 text-yellow-800',
  ANALYZING: 'bg-orange-100 text-orange-800',
  DEBATING: 'bg-purple-100 text-purple-800',
  CONCLUDED: 'bg-green-100 text-green-800',
  DISTRIBUTED: 'bg-gray-100 text-gray-800',
  ARCHIVED: 'bg-gray-100 text-gray-500',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AlertsPage(): React.ReactElement {
  const router = useRouter();
  const hydrated = useActiveOrg((s) => s.hydrated);

  const [statusFilter, setStatusFilter] = useState<AlertStatus | ''>('');
  const [assigneeIdFilter, setAssigneeIdFilter] = useState('');

  const [items, setItems] = useState<AlertListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function fetchAlerts(cursor?: string, replace = false) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (assigneeIdFilter.trim()) params.set('assigneeId', assigneeIdFilter.trim());
      if (cursor) params.set('cursor', cursor);
      params.set('limit', '20');

      const search = params.toString() ? `?${params.toString()}` : '';
      const res = await apiFetch(`/api/alerts${search}`);
      if (!res.ok) {
        setError(`Failed to load alerts (${res.status})`);
        return;
      }
      const data = (await res.json()) as CursorPage<AlertListItem>;
      setItems((prev) => (replace ? data.items : [...prev, ...data.items]));
      setNextCursor(data.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  // Fetch when filters change (once hydrated)
  useEffect(() => {
    if (!hydrated) return;
    void fetchAlerts(undefined, true);
  }, [hydrated, statusFilter, assigneeIdFilter]);

  function handleLoadMore() {
    if (!nextCursor) return;
    startTransition(() => {
      void fetchAlerts(nextCursor);
    });
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Alerts</h1>
        <Button onClick={() => router.push('/alerts/new')} data-testid="new-alert-btn">
          + New Alert
        </Button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3" data-testid="alerts-filters">
        <div className="w-48">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as AlertStatus | '')}
            className={inputCls}
            aria-label="Filter by status"
            data-testid="filter-status"
          >
            <option value="">All statuses</option>
            {ALERT_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="w-64">
          <input
            type="text"
            value={assigneeIdFilter}
            onChange={(e) => setAssigneeIdFilter(e.target.value)}
            placeholder="Filter by assignee ID…"
            className={inputCls}
            aria-label="Filter by assignee ID"
            data-testid="filter-assignee"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <p role="alert" className="text-destructive mb-4 text-sm" data-testid="alerts-error">
          {error}
        </p>
      )}

      {/* Loading skeleton */}
      {loading && items.length === 0 && (
        <div className="space-y-2" aria-busy="true" data-testid="alerts-loading">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-muted h-16 animate-pulse rounded-md" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && !error && (
        <p className="text-muted-foreground text-sm" data-testid="alerts-empty">
          No alerts found.
        </p>
      )}

      {/* Alert list */}
      {items.length > 0 && (
        <div className="space-y-2" data-testid="alerts-list">
          {items.map((alert) => (
            <button
              key={alert.id}
              type="button"
              onClick={() => router.push(`/alerts/${alert.id}`)}
              className={cn(
                'border-border bg-card flex w-full items-center justify-between rounded-md border px-4 py-3',
                'hover:bg-muted/50 text-left transition-colors',
              )}
              data-testid={`alert-row-${alert.id}`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{alert.title}</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {alert.severity} · {alert.source} ·{' '}
                  {new Date(alert.detectedAt).toLocaleDateString()}
                  {alert.assignee && <> · {alert.assignee.name ?? alert.assignee.email}</>}
                </p>
              </div>
              <span
                className={cn(
                  'ml-4 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                  STATUS_BADGE[alert.status],
                )}
              >
                {alert.status}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Load more */}
      {nextCursor && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            onClick={handleLoadMore}
            disabled={isPending || loading}
            data-testid="load-more-btn"
          >
            {isPending || loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
