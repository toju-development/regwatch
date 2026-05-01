import type { MonthlyUsage } from '@regwatch/db/usage';

/**
 * Wire shape for `GET /org/:orgId/usage/current` (MVP-5 B6 / R-12).
 *
 * Two transport-layer concerns vs the internal `MonthlyUsage` primitive:
 *
 *   1. **Decimals are serialized as strings.** `Prisma.Decimal` does not
 *      survive `JSON.stringify` faithfully (it would emit a structured
 *      object, not a number, and any `Number()` coercion at the client
 *      risks float drift). R-12 spec scenario "Decimal serialized as
 *      string" pins this — the body MUST contain `"costUsd":"1.234567"`.
 *      INV-SP-3 (`Prisma.Decimal` end-to-end) is upheld by keeping the
 *      coercion at the wire boundary, not the service.
 *   2. **`percent` is clamped to `[0, 100]`.** The `getMonthlyUsage`
 *      helper returns the raw integer-truncated percent which MAY exceed
 *      100 if the cap was breached mid-scan (one over-shoot per worst-case
 *      run, ~$0.10, per ADR-6). The widget renders a progress bar; values
 *      >100 would overflow visually. Clamping HERE (not in the helper)
 *      keeps the helper's number faithful for cost-monitoring callers
 *      while giving the widget a safe display value.
 *
 * Shape mirrors design ADR-11 (`currentMonth` envelope + `isAtCap` flag at
 * top level so the client can short-circuit the "cap reached" UI without
 * re-deriving from numbers).
 *
 * Spec: `sdd/scanner-vertical-ar/spec` R-12-UsageReadEndpoint, R-13-UsageWidget,
 *   INV-SP-3, INV-UT-1.
 * Design: `sdd/scanner-vertical-ar/design` ADR-11.
 */
export interface UsageDto {
  /** Sum of `ScanLog.tokensUsed` for the current UTC month. */
  tokensUsed: number;
  /** Decimal serialized as string to avoid float drift (R-12). */
  costUsd: string;
  /** Count of `ScanLog` rows for the month (any status). */
  scansCount: number;
  /** Decimal serialized as string. Currently `"10"` per `MONTHLY_CAP_USD`. */
  capUsd: string;
  /** Integer 0..100, clamped at 100 even when raw helper value exceeds it. */
  percent: number;
  /** ISO-8601 of the lower bound used by the aggregation (audit / debug). */
  monthStart: string;
}

/**
 * Wrapped response envelope. Mirrors the `{ settings: {...} }` and
 * `{ members: [...] }` envelopes from the sibling org-scoped endpoints
 * so the web client's response-shape contract stays uniform.
 *
 * `currentMonth` is the per-period bucket (a forward-compat slot — MVP-13
 * may add `previousMonth` for trend rendering); `isAtCap` is hoisted
 * outside the bucket so the widget can short-circuit the cap-reached UI
 * without parsing numbers.
 */
export interface UsageResponseDto {
  currentMonth: UsageDto;
  isAtCap: boolean;
}

/**
 * Map a `MonthlyUsage` primitive to the wire DTO. Pure function — safe to
 * call from any handler without re-reading.
 *
 * Decimal → string via `.toString()` (Prisma's canonical wire format).
 * `percent` is clamped via `Math.min(100, helper.percent)` — under-cap
 * values pass through untouched; over-cap values display as `100` even
 * though the helper tracks the true overrun internally.
 */
export function toUsageDto(usage: MonthlyUsage): UsageDto {
  return {
    tokensUsed: usage.tokensUsed,
    costUsd: usage.costUsd.toString(),
    scansCount: usage.scansCount,
    capUsd: usage.capUsd.toString(),
    percent: Math.min(100, Math.max(0, usage.percent)),
    monthStart: usage.monthStart.toISOString(),
  };
}

/**
 * Build the wrapped response envelope from a `MonthlyUsage` primitive.
 * Single call site (controller) — kept here to keep the controller method
 * pure-orchestration (no inline mapping).
 */
export function toUsageResponseDto(usage: MonthlyUsage): UsageResponseDto {
  return {
    currentMonth: toUsageDto(usage),
    isAtCap: usage.isAtCap,
  };
}
