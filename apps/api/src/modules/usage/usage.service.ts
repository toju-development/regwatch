import { Inject, Injectable } from '@nestjs/common';
import type { MonthlyUsage } from '@regwatch/db/usage';
import { USAGE_REPO_TOKEN, type UsageRepo } from './usage.repo.js';

/**
 * Usage domain service (MVP-5 B6).
 *
 * Single read method:
 *
 *   - {@link getCurrent} — returns the rich {@link MonthlyUsage} for one
 *     organization. Pass-through to the repo; the controller layer maps
 *     to the wire DTO (Decimal → string per R-12 / INV-SP-3).
 *
 * No mutations live here — `ScanLog` rows are written EXCLUSIVELY by
 * `apps/scanner` `ScanService.runScan` (INV-SP-1, the chokepoint). This
 * service is read-only by design.
 *
 * Why a service if it's a one-line repo pass-through?
 *   - Mirrors the canonical `SettingsService` / `MembersService` pattern
 *     so the test surface and DI graph stay uniform across modules.
 *   - Future extensions (caching, multi-org rollups, quota emails) land
 *     HERE without disturbing the controller or repo.
 *
 * Foot-gun #667: explicit `@Inject(...)` for every constructor param
 * under tsx + NestJS DI (esbuild does NOT emit `design:paramtypes`).
 *
 * Spec: `sdd/scanner-vertical-ar/spec` R-11-CanScanThisMonth, R-12-UsageReadEndpoint,
 *   INV-UT-1 (single source of truth), INV-UT-2 (no caching MVP-5).
 * Design: `sdd/scanner-vertical-ar/design` ADR-11.
 */
@Injectable()
export class UsageService {
  constructor(@Inject(USAGE_REPO_TOKEN) private readonly repo: UsageRepo) {}

  /**
   * Aggregate month-to-date usage for `organizationId`. Returns the rich
   * Decimal-typed shape; DTO serialization happens at the controller.
   *
   * INV-UT-2: every call hits the DB fresh (no in-memory cache MVP-5).
   * The widget polls on mount; staleness is bounded by the polling interval.
   */
  async getCurrent(organizationId: string): Promise<MonthlyUsage> {
    return this.repo.getMonthly(organizationId);
  }
}
