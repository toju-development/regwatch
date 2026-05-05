/**
 * UsageHelper — canonical "how much has this org spent this month" reader.
 *
 * Shared by:
 *   - `apps/scanner` → pre-LLM cap gate in `ScanService.runScan` (R-5) and
 *     pre-enrichment cap gate in `EnrichmentService` (R-5, MVP-6).
 *   - `apps/api`     → `GET /org/:orgId/usage/current` widget (R-11).
 *
 * Spec: `sdd/scanner-vertical-ar/spec` R-5, R-6, R-11-CanScanThisMonth, R-14,
 *   INV-SP-3 (`Prisma.Decimal` end-to-end), INV-UT-1 (single source of truth).
 *   `sdd/classifier-and-writer/spec` R-Usage-3 (enrichment cost included),
 *   INV-Usage-3 (no double-counting across ScanLog + EnrichmentLog).
 * Design: `sdd/scanner-vertical-ar/design` ADR-6 (cap + mutex flow).
 *   `sdd/classifier-and-writer/design` ADR-12 (shared cost helper + attribution).
 *
 * Foot-gun #1: ALL arithmetic MUST use `Prisma.Decimal`. NEVER JS `number`.
 *   `prisma.scanLog.aggregate({_sum:{costUsd:true}})` returns `Decimal | null`.
 *   We coerce `null` (no rows yet this month) to `Decimal(0)` on BOTH sides
 *   (ScanLog + EnrichmentLog). The foot-gun is that `null ?? 0` returns JS 0
 *   (a number), not `Decimal(0)`. Always use `?? new Prisma.Decimal(0)`.
 *
 * Foot-gun #2 (#731): NO `import 'server-only'` here — `apps/scanner` runs
 *   under tsx (not Next.js bundler), and `server-only` would crash the import.
 *   Server-only enforcement at the boundary: the `@regwatch/db/usage` subpath
 *   is consumed exclusively by server-side processes (`apps/api`, `apps/scanner`).
 *   `apps/web` MUST NOT import this file.
 */
import { Prisma, type PrismaClient } from './generated/client/index.js';

import { MONTHLY_CAP_USD } from '@regwatch/types/pricing';

/** First instant of the current UTC calendar month (inclusive lower bound). */
export function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** Decimal-typed cap exposed as a constant so callers don't re-instantiate. */
export const MONTHLY_CAP_DECIMAL = new Prisma.Decimal(MONTHLY_CAP_USD);

/**
 * Rich primitive: full month-to-date usage for one organization.
 *
 * Returned shape is denormalized so callers (API widget, scanner cap gate,
 * future quota emails) don't each re-derive percent / isAtCap and risk a drift.
 *
 * MVP-6 (R-Usage-3): `costUsd` now includes BOTH `ScanLog.costUsd` AND
 * `EnrichmentLog.costUsd`. The $10 cap covers scan + classify + write combined.
 * INV-Usage-3: NO double-counting — separate tables, separate sums, combined here.
 */
export interface MonthlyUsage {
  /** Sum of `ScanLog.tokensUsed` for the current UTC month. */
  tokensUsed: number;
  /**
   * Combined sum of `ScanLog.costUsd + EnrichmentLog.costUsd` for the current
   * UTC month (Decimal, never number). This is the value checked against the cap.
   * MVP-6 (R-Usage-3, INV-Usage-3).
   */
  costUsd: Prisma.Decimal;
  /** Breakdown: scan-only cost (for audit/display). MVP-6 addition. */
  scanCostUsd: Prisma.Decimal;
  /** Breakdown: enrichment-only cost (for audit/display). MVP-6 addition. */
  enrichmentCostUsd: Prisma.Decimal;
  /** Count of `ScanLog` rows (any status — incl. SKIPPED_CAP_EXCEEDED) for the month. */
  scansCount: number;
  /** Hard cap (currently `$10` per `@regwatch/types/pricing`). */
  capUsd: Prisma.Decimal;
  /**
   * `true` IFF `costUsd >= capUsd`. Boundary: exactly at cap counts AS at-cap
   * — the next scan or enrichment MUST be skipped (R-5 boundary scenario).
   */
  isAtCap: boolean;
  /** Integer-truncated 0-100. UI does its own formatting. May exceed 100 if over. */
  percent: number;
  /** Lower bound used by the aggregation (debug / audit). */
  monthStart: Date;
}

/**
 * R-11 thin contract — kept for the `GET /org/:orgId/usage/current` widget
 * which signed up for this exact shape during MVP-4 spec review. New callers
 * should prefer `getMonthlyUsage` (richer + canonical).
 */
export interface CanScanResult {
  allowed: boolean;
  currentUsd: Prisma.Decimal;
  capUsd: Prisma.Decimal;
  /** Integer-truncated 0-100. Display formatting (floor) lives in the UI. */
  percent: number;
}

/**
 * Aggregate month-to-date usage for one organization.
 *
 * MVP-6 (R-Usage-3): two parallel Prisma aggregate queries — one on `ScanLog`,
 * one on `EnrichmentLog`. Both are indexed on `(organizationId, startedAt)` /
 * `(organizationId, createdAt)` so neither is a full-table scan. Combined total
 * is what's checked against the $10 cap (INV-Usage-3: no double-counting).
 *
 * Foot-gun: `?? new Prisma.Decimal(0)` — NOT `?? 0`. Prisma Decimal sum returns
 * `null` when no rows match; using `?? 0` would give a JS number, and
 * `Decimal.plus(0)` is fine but `Decimal.plus(number)` is implicit coercion
 * that could drift. Use `?? new Prisma.Decimal(0)` on BOTH sides.
 *
 * We pass `prisma` as a parameter (not a global) so unit tests can mock and
 * integration tests can use a real client.
 */
export async function getMonthlyUsage(
  prisma: PrismaClient,
  organizationId: string,
  now: Date = new Date(),
): Promise<MonthlyUsage> {
  const monthStart = startOfMonthUtc(now);

  // Two parallel aggregations — one round-trip each, both indexed.
  const [scanAgg, enrichmentAgg] = await Promise.all([
    prisma.scanLog.aggregate({
      where: {
        organizationId,
        startedAt: { gte: monthStart },
      },
      _sum: { tokensUsed: true, costUsd: true },
      _count: { _all: true },
    }),
    prisma.enrichmentLog.aggregate({
      where: {
        organizationId,
        createdAt: { gte: monthStart },
      },
      _sum: { costUsd: true },
    }),
  ]);

  const tokensUsed = scanAgg._sum.tokensUsed ?? 0;
  // Coerce null (no rows this month) → Decimal(0). NEVER use `?? 0` (JS number).
  const scanCostUsd = scanAgg._sum.costUsd ?? new Prisma.Decimal(0);
  const enrichmentCostUsd = enrichmentAgg._sum.costUsd ?? new Prisma.Decimal(0);
  const scansCount = scanAgg._count._all;

  // Combined total is the cap gate value (R-Usage-3).
  const costUsd = scanCostUsd.plus(enrichmentCostUsd);

  // Boundary: exactly at cap counts as at-cap (`>=`). R-5 spec scenario.
  const isAtCap = costUsd.greaterThanOrEqualTo(MONTHLY_CAP_DECIMAL);

  // `percent` is integer-truncated. `Decimal.mul(100).div(cap).floor().toNumber()`
  // returns a JS number ONLY at the very last step (display value, not money).
  const percent = costUsd.mul(100).div(MONTHLY_CAP_DECIMAL).floor().toNumber();

  return {
    tokensUsed,
    costUsd,
    scanCostUsd,
    enrichmentCostUsd,
    scansCount,
    capUsd: MONTHLY_CAP_DECIMAL,
    isAtCap,
    percent,
    monthStart,
  };
}

/**
 * R-11 thin wrapper around `getMonthlyUsage` for the widget endpoint contract.
 * `allowed = !isAtCap` so the cap gate is identical on both call sites.
 */
export async function canScanThisMonth(
  prisma: PrismaClient,
  organizationId: string,
  now: Date = new Date(),
): Promise<CanScanResult> {
  const usage = await getMonthlyUsage(prisma, organizationId, now);
  return {
    allowed: !usage.isAtCap,
    currentUsd: usage.costUsd,
    capUsd: usage.capUsd,
    percent: usage.percent,
  };
}
