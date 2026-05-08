/**
 * `<AlertDetailClient>` — interactive client island for the alert detail page.
 *
 * Spec: sdd/alert-collaboration/spec — web-alerts domain.
 * Design: client component receives initialData from RSC shell; handles
 *   mutations via Server Actions; polls via router.refresh() every 30s.
 *
 * Features:
 *   - Metadata display: title, status badge, severity, topic, executive summary,
 *     assignee, jurisdiction, regulator, enrichment metadata.
 *   - Status transition buttons (filtered by ALERT_TRANSITIONS + actor role).
 *   - Assign to member (text input for MVP).
 *   - Conclusion textarea (OWNER/ADMIN only).
 *   - Comment thread with cursor pagination (load more).
 *   - Add comment form (textarea + submit + optional parentId for replies).
 *   - Audit event feed (read-only).
 *   - Polls via router.refresh() every 30s.
 *
 * NO `pnpm build` after changes (project rule).
 */
'use client';

import { useState, useEffect, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { useActiveOrg } from '@/lib/active-org-store';
import { apiFetch } from '@/lib/api-fetch';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { AlertStatus, CursorPage } from '@regwatch/types';
import { ALERT_TRANSITIONS } from '@regwatch/types';

import { transitionAlert, assignAlert, concludeAlert, addComment, deleteComment } from './actions';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AssigneeShape {
  id: string;
  name: string | null;
  email: string;
}

interface AlertWithMeta {
  id: string;
  organizationId: string;
  status: AlertStatus;
  assigneeId: string | null;
  conclusion: string | null;
  regulator: string | null;
  title: string;
  summary: string | null;
  publishedAt: string | null;
  detectedAt: string;
  source: string;
  sourceUrl: string;
  severity: string;
  enrichmentStatus: string;
  executiveSummary: string | null;
  whatChangesForYou: string | null;
  assignee: AssigneeShape | null;
  _count: { comments: number };
}

interface CommentRow {
  id: string;
  alertId: string;
  organizationId: string;
  authorId: string;
  body: string;
  parentId: string | null;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface EventRow {
  id: string;
  alertId: string;
  actorId: string;
  kind: string;
  fromStatus: AlertStatus | null;
  toStatus: AlertStatus | null;
  assigneeId: string | null;
  note: string | null;
  createdAt: string;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<AlertStatus, string> = {
  NEW: 'bg-blue-100 text-blue-800',
  TRIAGING: 'bg-yellow-100 text-yellow-800',
  ANALYZING: 'bg-orange-100 text-orange-800',
  DEBATING: 'bg-purple-100 text-purple-800',
  CONCLUDED: 'bg-green-100 text-green-800',
  DISTRIBUTED: 'bg-gray-100 text-gray-800',
  ARCHIVED: 'bg-gray-100 text-gray-500',
};

const inputCls =
  'block w-full rounded-md border border-input bg-background px-3 py-2 text-sm ' +
  'placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const errorCls = 'mt-1 text-xs text-destructive';

// ─── Component ────────────────────────────────────────────────────────────────

export interface AlertDetailClientProps {
  alertId: string;
  initialData: unknown;
}

export function AlertDetailClient({
  alertId,
  initialData,
}: AlertDetailClientProps): React.ReactElement {
  const router = useRouter();
  const role = useActiveOrg(
    (s) =>
      s.memberships.find((m) => m.organizationId === (initialData as AlertWithMeta).organizationId)
        ?.role,
  );

  // Alert state (refreshed on router.refresh())
  const [alert, setAlert] = useState<AlertWithMeta>(initialData as AlertWithMeta);

  // Comments
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentsCursor, setCommentsCursor] = useState<string | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);

  // Events
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  // Mutation state
  const [isPending, startTransition] = useTransition();
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Comment form
  const [commentBody, setCommentBody] = useState('');
  const [replyToId, setReplyToId] = useState<string | null>(null);

  // Assign form
  const [assigneeInput, setAssigneeInput] = useState(alert.assigneeId ?? '');

  // Conclusion form
  const [conclusionText, setConclusionText] = useState(alert.conclusion ?? '');

  // Sync client state when initialData changes (router.refresh() polling)
  useEffect(() => {
    setAlert(initialData as AlertWithMeta);
    setAssigneeInput((initialData as AlertWithMeta).assigneeId ?? '');
    setConclusionText((initialData as AlertWithMeta).conclusion ?? '');
  }, [initialData]);

  // ── Fetch comments ─────────────────────────────────────────────────────────

  const fetchComments = useCallback(
    async (cursor?: string, replace = false) => {
      setCommentsLoading(true);
      try {
        const params = new URLSearchParams({ limit: '20' });
        if (cursor) params.set('cursor', cursor);
        const res = await apiFetch(`/api/alerts/${alertId}/comments?${params.toString()}`);
        if (res.ok) {
          const data = (await res.json()) as CursorPage<CommentRow>;
          setComments((prev) => (replace ? data.items : [...prev, ...data.items]));
          setCommentsCursor(data.nextCursor);
        }
      } finally {
        setCommentsLoading(false);
      }
    },
    [alertId],
  );

  // ── Fetch events ───────────────────────────────────────────────────────────

  const fetchEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const res = await apiFetch(`/api/alerts/${alertId}/events`);
      if (res.ok) {
        const data = (await res.json()) as EventRow[];
        setEvents(data);
      }
    } finally {
      setEventsLoading(false);
    }
  }, [alertId]);

  // ── On mount: load comments + events ──────────────────────────────────────

  useEffect(() => {
    void fetchComments(undefined, true);
    void fetchEvents();
  }, [fetchComments, fetchEvents]);

  // ── Poll via router.refresh() every 30s ───────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh();
    }, 30_000);
    return () => clearInterval(interval);
  }, [router]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function handleError(msg: string) {
    setMutationError(msg);
  }

  // ── Transition ────────────────────────────────────────────────────────────

  const reachable = ALERT_TRANSITIONS[alert.status] ?? [];

  // Filter out system-only DISTRIBUTED transition
  const humanReachable = reachable.filter((s) => s !== 'DISTRIBUTED');

  // Role-based: VIEWER sees no transition buttons (parent guard handles 403)
  const canTransition = role === 'OWNER' || role === 'ADMIN' || role === 'ANALYST';

  function handleTransition(toStatus: AlertStatus) {
    setMutationError(null);
    startTransition(async () => {
      const result = await transitionAlert(alertId, toStatus);
      if (result.ok) {
        setAlert(result.data as AlertWithMeta);
        void fetchEvents();
      } else {
        handleError(result.error ?? 'Transition failed');
      }
    });
  }

  // ── Assign ────────────────────────────────────────────────────────────────

  const canAssign = role === 'OWNER' || role === 'ADMIN' || role === 'ANALYST';

  function handleAssign() {
    setMutationError(null);
    const targetId = assigneeInput.trim() || null;
    startTransition(async () => {
      const result = await assignAlert(alertId, targetId);
      if (result.ok) {
        setAlert(result.data as AlertWithMeta);
        void fetchEvents();
      } else {
        handleError(result.error ?? 'Assign failed');
      }
    });
  }

  // ── Conclude ──────────────────────────────────────────────────────────────

  const canConclude = role === 'OWNER' || role === 'ADMIN';

  function handleConclude() {
    setMutationError(null);
    startTransition(async () => {
      const result = await concludeAlert(alertId, conclusionText);
      if (result.ok) {
        setAlert(result.data as AlertWithMeta);
        void fetchEvents();
      } else {
        handleError(result.error ?? 'Conclude failed');
      }
    });
  }

  // ── Add comment ───────────────────────────────────────────────────────────

  const canComment = role === 'OWNER' || role === 'ADMIN' || role === 'ANALYST';

  function handleAddComment() {
    if (!commentBody.trim()) return;
    setMutationError(null);
    startTransition(async () => {
      const result = await addComment(alertId, commentBody, replyToId ?? undefined);
      if (result.ok) {
        setCommentBody('');
        setReplyToId(null);
        void fetchComments(undefined, true);
        void fetchEvents();
      } else {
        handleError(result.error ?? 'Comment failed');
      }
    });
  }

  // ── Delete comment ────────────────────────────────────────────────────────

  function handleDeleteComment(commentId: string) {
    setMutationError(null);
    startTransition(async () => {
      const result = await deleteComment(alertId, commentId);
      if (result.ok) {
        void fetchComments(undefined, true);
      } else {
        handleError(result.error ?? 'Delete failed');
      }
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold" data-testid="alert-title">
            {alert.title}
          </h1>
          <span
            className={cn(
              'shrink-0 rounded-full px-3 py-1 text-sm font-medium',
              STATUS_BADGE[alert.status],
            )}
            data-testid="alert-status-badge"
          >
            {alert.status}
          </span>
        </div>

        {/* Metadata grid */}
        <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Severity</dt>
            <dd className="font-medium" data-testid="alert-severity">
              {alert.severity}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Source</dt>
            <dd className="font-medium">{alert.source}</dd>
          </div>
          {alert.regulator && (
            <div>
              <dt className="text-muted-foreground">Regulator</dt>
              <dd className="font-medium" data-testid="alert-regulator">
                {alert.regulator}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-muted-foreground">Enrichment</dt>
            <dd className="font-medium">{alert.enrichmentStatus}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Detected</dt>
            <dd className="font-medium">{new Date(alert.detectedAt).toLocaleDateString()}</dd>
          </div>
          {alert.assignee && (
            <div>
              <dt className="text-muted-foreground">Assignee</dt>
              <dd className="font-medium" data-testid="alert-assignee">
                {alert.assignee.name ?? alert.assignee.email}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Executive summary */}
      {alert.executiveSummary && (
        <section>
          <h2 className="mb-2 text-base font-semibold">Executive Summary</h2>
          <p className="text-foreground/80 text-sm leading-relaxed" data-testid="alert-summary">
            {alert.executiveSummary}
          </p>
        </section>
      )}

      {/* What changes for you */}
      {alert.whatChangesForYou && (
        <section>
          <h2 className="mb-2 text-base font-semibold">What Changes For You</h2>
          <p className="text-foreground/80 text-sm leading-relaxed">{alert.whatChangesForYou}</p>
        </section>
      )}

      {/* Mutation error */}
      {mutationError && (
        <p role="alert" className={cn(errorCls, 'text-sm')} data-testid="mutation-error">
          {mutationError}
        </p>
      )}

      {/* ── Status transitions ── */}
      {canTransition && humanReachable.length > 0 && (
        <section>
          <h2 className="mb-2 text-base font-semibold">Transition Status</h2>
          <div className="flex flex-wrap gap-2">
            {humanReachable.map((toStatus) => (
              <Button
                key={toStatus}
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => handleTransition(toStatus)}
                data-testid={`transition-btn-${toStatus}`}
              >
                → {toStatus}
              </Button>
            ))}
          </div>
        </section>
      )}

      {/* ── Assign ── */}
      {canAssign && (
        <section>
          <h2 className="mb-2 text-base font-semibold">Assign</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={assigneeInput}
              onChange={(e) => setAssigneeInput(e.target.value)}
              placeholder="Member ID (leave blank to unassign)"
              className={cn(inputCls, 'max-w-xs')}
              disabled={isPending}
              data-testid="assign-input"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleAssign}
              disabled={isPending}
              data-testid="assign-btn"
            >
              {assigneeInput.trim() ? 'Assign' : 'Unassign'}
            </Button>
          </div>
        </section>
      )}

      {/* ── Conclusion ── */}
      {canConclude && (
        <section>
          <h2 className="mb-2 text-base font-semibold">Conclusion</h2>
          <textarea
            value={conclusionText}
            onChange={(e) => setConclusionText(e.target.value)}
            rows={4}
            placeholder="Write the compliance conclusion…"
            className={cn(inputCls, 'resize-y')}
            disabled={isPending}
            data-testid="conclusion-textarea"
          />
          <Button
            className="mt-2"
            size="sm"
            onClick={handleConclude}
            disabled={isPending || !conclusionText.trim()}
            data-testid="conclusion-btn"
          >
            Save Conclusion
          </Button>
          {alert.conclusion && (
            <p className="text-muted-foreground mt-1 text-xs">
              Current: {alert.conclusion.slice(0, 120)}
              {alert.conclusion.length > 120 ? '…' : ''}
            </p>
          )}
        </section>
      )}

      {/* ── Comments ── */}
      <section>
        <h2 className="mb-3 text-base font-semibold">Comments ({alert._count.comments})</h2>

        {commentsLoading && comments.length === 0 && (
          <div className="space-y-2" aria-busy="true">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-muted h-12 animate-pulse rounded" />
            ))}
          </div>
        )}

        {comments.length > 0 && (
          <div className="space-y-3" data-testid="comments-list">
            {comments.map((c) => (
              <div
                key={c.id}
                className={cn(
                  'border-border bg-card rounded-md border px-4 py-3',
                  c.parentId && 'ml-6 border-l-4 border-l-blue-200',
                )}
                data-testid={`comment-${c.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="flex-1 text-sm">{c.body}</p>
                  <div className="flex shrink-0 gap-2">
                    {/* Reply (only for top-level) */}
                    {!c.parentId && canComment && (
                      <button
                        type="button"
                        className="text-xs text-blue-600 hover:underline"
                        onClick={() => setReplyToId(replyToId === c.id ? null : c.id)}
                        data-testid={`reply-btn-${c.id}`}
                      >
                        {replyToId === c.id ? 'Cancel' : 'Reply'}
                      </button>
                    )}
                    {/* Delete */}
                    <button
                      type="button"
                      className="text-destructive text-xs hover:underline disabled:opacity-50"
                      onClick={() => handleDeleteComment(c.id)}
                      disabled={isPending}
                      data-testid={`delete-comment-${c.id}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  {new Date(c.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}

        {commentsCursor && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void fetchComments(commentsCursor)}
            disabled={commentsLoading}
            data-testid="load-more-comments"
          >
            Load more comments
          </Button>
        )}

        {/* Add comment form */}
        {canComment && (
          <div className="mt-4 space-y-2" data-testid="comment-form">
            {replyToId && (
              <p className="text-muted-foreground text-xs">
                Replying to comment <span className="font-mono">{replyToId.slice(0, 8)}…</span>
                <button
                  type="button"
                  className="text-destructive ml-2 hover:underline"
                  onClick={() => setReplyToId(null)}
                >
                  Cancel
                </button>
              </p>
            )}
            <textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              rows={3}
              placeholder="Add a comment…"
              className={cn(inputCls, 'resize-y')}
              disabled={isPending}
              data-testid="comment-input"
            />
            <Button
              size="sm"
              onClick={handleAddComment}
              disabled={isPending || !commentBody.trim()}
              data-testid="submit-comment"
            >
              {isPending ? 'Posting…' : 'Post Comment'}
            </Button>
          </div>
        )}
      </section>

      {/* ── Audit event feed ── */}
      <section>
        <h2 className="mb-3 text-base font-semibold">Audit Log</h2>

        {eventsLoading && (
          <div className="space-y-1" aria-busy="true">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-muted h-8 animate-pulse rounded" />
            ))}
          </div>
        )}

        {events.length > 0 && (
          <ol className="space-y-1 text-sm" data-testid="events-list">
            {events.map((ev) => (
              <li key={ev.id} className="text-foreground/70 flex items-baseline gap-2">
                <time className="shrink-0 text-xs tabular-nums">
                  {new Date(ev.createdAt).toLocaleString()}
                </time>
                <span>
                  <span className="font-medium">{ev.kind}</span>
                  {ev.fromStatus && ev.toStatus && (
                    <>
                      {' '}
                      {ev.fromStatus} → {ev.toStatus}
                    </>
                  )}
                  {ev.assigneeId && <> → {ev.assigneeId}</>}
                  {ev.note && <> · {ev.note}</>}
                </span>
              </li>
            ))}
          </ol>
        )}

        {!eventsLoading && events.length === 0 && (
          <p className="text-muted-foreground text-sm" data-testid="events-empty">
            No events yet.
          </p>
        )}
      </section>
    </div>
  );
}
