import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@regwatch/db/client';
import { getMonthlyUsage, type MonthlyUsage } from '@regwatch/db/usage';
import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';
import { USAGE_REPO_TOKEN } from './tokens.js';

/**
 * Persistence boundary for the usage module (MVP-5 B6).
 *
 * Single read operation:
 *
 *   - {@link getMonthly} — month-to-date usage for one organization,
 *     delegating to the canonical `@regwatch/db/usage#getMonthlyUsage`
 *     helper (the SAME helper the scanner uses for cap-gate enforcement,
 *     INV-UT-1: single source of truth).
 *
 * The repo is a THIN seam over the helper — its only responsibilities are
 * (a) injecting the `PrismaClient` via DI (so tests can swap it) and (b)
 * exposing an interface the service can mock without touching `prisma`.
 *
 * Why have a repo at all (vs calling the helper directly from the service)?
 *   1. Mirrors the `SettingsRepo` / `MembersRepo` pattern — every domain
 *      module in `apps/api` keeps the same shape, which keeps the test
 *      scaffolding uniform (mocked-repo unit specs everywhere).
 *   2. Lets us swap the data source in MVP-13 (e.g. cached aggregates,
 *      materialized view) WITHOUT touching the service or controller.
 *
 * Foot-gun #667: explicit `@Inject(PRISMA_CLIENT)` on every constructor
 * param under tsx + NestJS DI.
 *
 * Spec: `sdd/scanner-vertical-ar/spec` R-11-CanScanThisMonth, R-12-UsageReadEndpoint.
 * Design: `sdd/scanner-vertical-ar/design` ADR-11 (response shape), ADR-15.
 */
export interface UsageRepo {
  /**
   * Aggregate month-to-date usage for `organizationId`. Optional `now`
   * override is plumbed for deterministic tests; production calls leave
   * it undefined (helper defaults to `new Date()`).
   *
   * Returns the rich `MonthlyUsage` shape (Decimal-typed). The DTO
   * mapper at the controller boundary handles wire-format coercion
   * (Decimal → string per INV-SP-3 / R-12 Decimal-as-string scenario).
   */
  getMonthly(organizationId: string, now?: Date): Promise<MonthlyUsage>;
}

/**
 * Prisma-backed implementation of {@link UsageRepo}.
 *
 * Holds no state — `PrismaClient` resolved via the global `PrismaModule`
 * (`PRISMA_CLIENT` token). The `getMonthlyUsage` helper is a free function
 * that takes the client as its first arg, so we pass our injected instance
 * straight through. No transaction wrapper: the helper issues a SINGLE
 * `prisma.scanLog.aggregate(...)` round-trip — no cross-row invariants.
 */
@Injectable()
export class PrismaUsageRepo implements UsageRepo {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async getMonthly(organizationId: string, now?: Date): Promise<MonthlyUsage> {
    return getMonthlyUsage(this.prisma, organizationId, now);
  }
}

// Convenience re-export so importers don't have to round-trip via
// `tokens.js` for the sole token they care about at this layer.
export { USAGE_REPO_TOKEN };
