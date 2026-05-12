/**
 * `/alerts/new` — manual ingestion page.
 *
 * Spec: `sdd/manual-ingestion/spec` § R-10 (Manual ingestion UI)
 *   - Tabs: URL | PDF | Paste
 *   - Common: jurisdiction (required), regulatorId (optional)
 *   - S1: success → redirect to `/dashboard` (no `/alerts/[id]` route yet)
 *   - S2: empty jurisdiction → inline error, Server Action NOT called
 *   - 409 → inline "Already exists" message with existing alertId
 *
 * Design: `sdd/manual-ingestion/design` — Module Structure row for
 *   `apps/web/src/app/(dashboard)/alerts/new/page.tsx`.
 *
 * Notes:
 *   - Client Component because the form requires tab state, loading state,
 *     and access to the active-org Zustand store.
 *   - No shadcn Tabs installed — custom tab implementation with Tailwind.
 *   - No react-hook-form installed — native form with React state validation.
 *   - No `/alerts/[id]` route — redirect to `/dashboard` after creation.
 *   - URL title auto-fill on blur: skipped (backend extracts the title).
 *   - PDF size check: client-side, before calling the Server Action.
 *
 * NO `pnpm build` after changes (project rule).
 */
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { useActiveOrg } from '@/lib/active-org-store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SUPPORTED_JURISDICTIONS } from '@regwatch/types';
import { ingestManual } from './actions';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type Tab = 'url' | 'pdf' | 'text';

const TAB_LABELS: Record<Tab, string> = {
  url: 'URL',
  pdf: 'PDF',
  text: 'Paste',
};

// ---------------------------------------------------------------------------
// Shared field styles (inline — no shadcn Input/Label installed)
// ---------------------------------------------------------------------------

const inputCls =
  'mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm ' +
  'placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const labelCls = 'block text-sm font-medium text-foreground';
const errorCls = 'mt-1 text-xs text-destructive';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NewAlertPage(): React.ReactElement {
  const router = useRouter();
  const activeOrgId = useActiveOrg((s) => s.activeOrgId);

  const [activeTab, setActiveTab] = useState<Tab>('url');
  const [isPending, startTransition] = useTransition();

  // Validation errors (per-field)
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Server-level error (not a field error)
  const [serverError, setServerError] = useState<string | null>(null);
  // 409 conflict
  const [conflict, setConflict] = useState<{ alertId: string } | null>(null);

  function clearState() {
    setErrors({});
    setServerError(null);
    setConflict(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    clearState();

    const form = e.currentTarget;
    const fd = new FormData(form);

    // Embed active-org so the Server Action can set X-Org-Id
    if (activeOrgId) fd.set('orgId', activeOrgId);
    fd.set('inputType', activeTab);

    // --- Client-side validation ---
    const newErrors: Record<string, string> = {};

    const jurisdiction = (fd.get('jurisdiction') as string | null)?.trim() ?? '';
    if (!jurisdiction) newErrors.jurisdiction = 'Jurisdiction is required';

    if (activeTab === 'url') {
      const url = (fd.get('url') as string | null)?.trim() ?? '';
      if (!url) newErrors.url = 'URL is required';
    }

    if (activeTab === 'text') {
      const text = (fd.get('text') as string | null)?.trim() ?? '';
      if (!text) newErrors.text = 'Text content is required';
      const title = (fd.get('title') as string | null)?.trim() ?? '';
      if (!title) newErrors.title = 'Title is required for pasted text';
    }

    if (activeTab === 'pdf') {
      const file = fd.get('file') as File | null;
      if (!file || file.size === 0) {
        newErrors.file = 'Please select a PDF file';
      } else if (file.size > 10 * 1024 * 1024) {
        newErrors.file = 'PDF must be under 10MB';
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // --- Call Server Action ---
    startTransition(async () => {
      const result = await ingestManual(fd);
      if (result.ok) {
        // No /alerts/[id] route yet — go to dashboard
        router.push(`/dashboard`);
      } else if ('conflict' in result && result.conflict) {
        setConflict({ alertId: result.alertId });
      } else {
        setServerError((result as { error?: string }).error ?? 'Something went wrong');
      }
    });
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">New Alert</h1>

      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Ingestion type"
        className="border-border mb-6 flex gap-1 border-b"
      >
        {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
          <button
            key={tab}
            role="tab"
            type="button"
            aria-selected={activeTab === tab}
            data-testid={`tab-${tab}`}
            onClick={() => {
              clearState();
              setActiveTab(tab);
            }}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors',
              activeTab === tab
                ? 'border-primary text-primary border-b-2'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} noValidate data-testid="new-alert-form">
        {/* ----- URL tab ----- */}
        {activeTab === 'url' && (
          <div className="space-y-4">
            <div>
              <label htmlFor="url" className={labelCls}>
                URL <span aria-hidden>*</span>
              </label>
              <input
                id="url"
                name="url"
                type="url"
                placeholder="https://example.com/regulation.html"
                pattern="https://.*"
                className={inputCls}
                data-testid="input-url"
                disabled={isPending}
              />
              {errors.url && (
                <p role="alert" className={errorCls} data-testid="error-url">
                  {errors.url}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="title-url" className={labelCls}>
                Title{' '}
                <span className="text-muted-foreground text-xs">
                  (optional — extracted automatically)
                </span>
              </label>
              <input
                id="title-url"
                name="title"
                type="text"
                placeholder="Page title"
                className={inputCls}
                disabled={isPending}
              />
            </div>
          </div>
        )}

        {/* ----- PDF tab ----- */}
        {activeTab === 'pdf' && (
          <div className="space-y-4">
            <div>
              <label htmlFor="file" className={labelCls}>
                PDF file <span aria-hidden>*</span>
              </label>
              <input
                id="file"
                name="file"
                type="file"
                accept="application/pdf"
                className={cn(inputCls, 'cursor-pointer')}
                data-testid="input-file"
                disabled={isPending}
              />
              {errors.file && (
                <p role="alert" className={errorCls} data-testid="error-file">
                  {errors.file}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="title-pdf" className={labelCls}>
                Title <span className="text-muted-foreground text-xs">(optional)</span>
              </label>
              <input
                id="title-pdf"
                name="title"
                type="text"
                placeholder="Document title"
                className={inputCls}
                disabled={isPending}
              />
            </div>
          </div>
        )}

        {/* ----- Paste/text tab ----- */}
        {activeTab === 'text' && (
          <div className="space-y-4">
            <div>
              <label htmlFor="title-text" className={labelCls}>
                Title <span aria-hidden>*</span>
              </label>
              <input
                id="title-text"
                name="title"
                type="text"
                placeholder="Regulation title"
                className={inputCls}
                data-testid="input-title"
                disabled={isPending}
              />
              {errors.title && (
                <p role="alert" className={errorCls} data-testid="error-title">
                  {errors.title}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="text" className={labelCls}>
                Content <span aria-hidden>*</span>
              </label>
              <textarea
                id="text"
                name="text"
                rows={8}
                placeholder="Paste regulatory text here…"
                className={cn(inputCls, 'resize-y')}
                data-testid="input-text"
                disabled={isPending}
              />
              {errors.text && (
                <p role="alert" className={errorCls} data-testid="error-text">
                  {errors.text}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ----- Common fields ----- */}
        <div className="mt-6 space-y-4">
          <div>
            <label htmlFor="jurisdiction" className={labelCls}>
              Jurisdiction <span aria-hidden>*</span>
            </label>
            <select
              id="jurisdiction"
              name="jurisdiction"
              defaultValue=""
              className={inputCls}
              data-testid="select-jurisdiction"
              disabled={isPending}
            >
              <option value="" disabled>
                Select jurisdiction…
              </option>
              {SUPPORTED_JURISDICTIONS.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
            {errors.jurisdiction && (
              <p role="alert" className={errorCls} data-testid="error-jurisdiction">
                {errors.jurisdiction}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="regulatorId" className={labelCls}>
              Regulator <span className="text-muted-foreground text-xs">(optional)</span>
            </label>
            <input
              id="regulatorId"
              name="regulatorId"
              type="text"
              placeholder="e.g. BCRA, Banco Central do Brasil"
              className={inputCls}
              disabled={isPending}
            />
          </div>
        </div>

        {/* ----- Conflict (409) ----- */}
        {conflict !== null && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            data-testid="conflict-message"
          >
            This content was already ingested.{' '}
            <a
              href={`/dashboard`}
              className="font-medium underline underline-offset-2 hover:no-underline"
              data-testid="conflict-link"
            >
              View alert →
            </a>
            <span className="ml-2 text-xs text-amber-600" data-testid="conflict-alert-id">
              ({conflict.alertId})
            </span>
          </div>
        )}

        {/* ----- Server error ----- */}
        {serverError !== null && (
          <p role="alert" className={cn(errorCls, 'mt-4')} data-testid="server-error">
            {serverError}
          </p>
        )}

        {/* ----- Submit ----- */}
        <div className="mt-6 flex items-center gap-3">
          <Button type="submit" disabled={isPending} data-testid="submit-button">
            {isPending ? (
              <>
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                  aria-hidden
                />
                Submitting…
              </>
            ) : (
              'Ingest Alert'
            )}
          </Button>

          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => router.push('/dashboard')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
