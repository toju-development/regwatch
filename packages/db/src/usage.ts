/**
 * UsageHelper skeleton — canonical "how much has this org spent this month"
 * reader, shared by `apps/scanner` (cap gate before LLM call) AND `apps/api`
 * (`GET /org/:orgId/usage/current` widget endpoint).
 *
 * Spec: `sdd/scanner-vertical-ar/spec` R-11-CanScanThisMonth, R-5,
 *   INV-UT-1 (cap is a single source of truth).
 * Design: `sdd/scanner-vertical-ar/design` ADR-6.
 *
 * Shape is locked here; full implementation lands in B4 (cap-enforcement
 * + boundary scenarios + integration tests against real Postgres).
 *
 * Foot-gun: ALL arithmetic MUST use `Prisma.Decimal`. NEVER JS `number`.
 *   `prisma.scanLog.aggregate({_sum:{costUsd:true}})` returns `Decimal | null`.
 */
import 'server-only';

import { Prisma } from './generated/client/index.js';

import { MONTHLY_CAP_USD } from '@regwatch/types/pricing';

/** First instant of the current UTC calendar month (inclusive lower bound). */
export function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** Decimal-typed cap exposed as a constant so callers don't re-instantiate. */
export const MONTHLY_CAP_DECIMAL = new Prisma.Decimal(MONTHLY_CAP_USD);

export interface CanScanResult {
  allowed: boolean;
  currentUsd: Prisma.Decimal;
  capUsd: Prisma.Decimal;
  /** Integer-truncated 0-100. Display formatting (floor) lives in the UI. */
  percent: number;
}

/**
 * MVP-5: skeleton only. Real implementation in B4 wires:
 *   - `prisma.scanLog.aggregate({where:{organizationId, startedAt:{gte}}, _sum:{costUsd:true}})`
 *   - boundary scenarios (just-under, exactly-at-cap)
 *   - per-org mutex serialization in `ScanService`
 *
 * Throws on call until B4 lands so any premature consumer fails loudly.
 */
export async function canScanThisMonth(orgId: string): Promise<CanScanResult> {
  throw new Error(
    `UsageHelper.canScanThisMonth(${orgId}): skeleton only — full implementation in MVP-5 B4.`,
  );
}
