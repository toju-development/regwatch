/**
 * `<UsageWidget>` — presentational widget for `/settings/usage`.
 *
 * Spec: `sdd/scanner-vertical-ar/spec`
 *   - R-13-UsageWidget S1 ("Widget renders zero usage" → literal
 *     `"$0.00 / $10.00 (0%)"`).
 *   - R-13-UsageWidget S2 ("Widget renders at-cap state" → `100%` +
 *     visible "cap reached" indicator).
 *
 * Design: `sdd/scanner-vertical-ar/design`
 *   - ADR-12 (Visualization: progress + numeric overlay
 *     `"$X.XX / $10.00 (XX%)"`; Tailwind colours green<70 / amber 70-90
 *     / red ≥90 / blocked ≥100).
 *
 * Pure presentational component — takes a single `usage` prop shaped
 * like the apps/api `UsageResponseDto` (B6) wire envelope. No client-
 * side fetch, no `'use client'` marker — the parent RSC page does the
 * `apiServerFetch` and passes the wire body straight in. A future
 * "manual refresh" button (ADR-12 deferred to MVP-5+) would wrap this
 * widget in a `'use client'` parent that calls `apiFetch` against the
 * PROXY route at `/api/org/[orgId]/usage/current` (B7.1 foundation).
 *
 * Display contract:
 *   - `costUsd` and `capUsd` arrive as Decimal-serialized strings (per
 *     R-12 + INV-SP-3). We `Number.parseFloat` + `.toFixed(2)` for the
 *     "$X.XX / $X.XX" overlay. Float drift here is fine — display only,
 *     not arithmetic.
 *   - `percent` arrives clamped to `[0, 100]` by the apps/api DTO mapper
 *     (foot-gun #11 carry-forward — clamp lives at the wire boundary,
 *     NOT the helper). We additionally `Math.floor` for the "(NN%)"
 *     overlay so the user sees "33%" instead of "33.7%".
 *   - When `isAtCap === true`, render an extra "cap reached" indicator
 *     (`data-testid="usage-widget-cap-reached"`) so the user knows the
 *     scanner will short-circuit the next run with `SKIPPED_CAP_EXCEEDED`.
 */
import type { UsageResponseDto } from './types';

export interface UsageWidgetProps {
  usage: UsageResponseDto;
}

/**
 * Pick a Tailwind colour bucket from the clamped percent value, per
 * ADR-12. The buckets escalate so the user gets early warning before
 * the cap kicks in (the scanner gate is at 100, not at 90).
 */
function colourForPercent(percent: number): string {
  if (percent >= 100) return 'bg-red-700';
  if (percent >= 90) return 'bg-red-500';
  if (percent >= 70) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function formatCurrency(value: string): string {
  // `Number.parseFloat('10') === 10` → `"10.00"`. Safe for display only.
  // Decimal precision for arithmetic is preserved upstream (Prisma.Decimal).
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return value; // defensive — surface unparseable upstream value.
  return `$${n.toFixed(2)}`;
}

export function UsageWidget({ usage }: UsageWidgetProps): React.ReactElement {
  const { currentMonth, isAtCap } = usage;
  // `percent` is already clamped [0,100] by the apps/api DTO mapper.
  // Floor for the integer overlay so we don't render fractional "%".
  // Defense-in-depth: clamp to [0,100] ONCE and reuse the same value for
  // BOTH the visual width AND `aria-valuenow`. Previously the width was
  // clamped via `Math.min(100, Math.max(0, percent))` but `aria-valuenow`
  // received the raw `flooredPercent` (>100 if upstream leaked) — screen
  // readers would announce "150%" while the bar visually pinned at 100%.
  // PR review fix.
  const flooredPercent = Math.floor(currentMonth.percent);
  const ariaPercent = Math.max(0, Math.min(100, flooredPercent));
  const costFmt = formatCurrency(currentMonth.costUsd);
  const capFmt = formatCurrency(currentMonth.capUsd);

  return (
    <section
      className="flex flex-col gap-3 rounded-md border p-4"
      data-testid="usage-widget"
      aria-label="Monthly LLM usage"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Usage this month</h2>
        <p className="text-muted-foreground text-xs">
          Hard cap at {capFmt}/month. Scans pause automatically when reached.
        </p>
      </header>

      {/*
        Native HTML <progress> for a11y + zero-JS rendering. Tailwind
        styling per ADR-12 colour buckets. We render a plain <div>
        overlay for the colour band because <progress>'s pseudo-elements
        are notoriously hard to style cross-browser. The numbers below
        carry the source-of-truth display (R-13 S1/S2 literal contract).
      */}
      <div
        className="bg-muted relative h-3 w-full overflow-hidden rounded-full"
        data-testid="usage-widget-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={ariaPercent}
      >
        <div
          className={`h-full transition-all ${colourForPercent(currentMonth.percent)}`}
          style={{ width: `${ariaPercent}%` }}
          data-testid="usage-widget-progress-bar"
        />
      </div>

      <p className="text-sm font-medium" data-testid="usage-widget-numbers">
        {costFmt} / {capFmt} ({flooredPercent}%)
      </p>

      {isAtCap ? (
        <p
          role="alert"
          className="text-destructive text-xs font-medium"
          data-testid="usage-widget-cap-reached"
        >
          Monthly cap reached. New scans will be skipped until the next billing month.
        </p>
      ) : null}
    </section>
  );
}
