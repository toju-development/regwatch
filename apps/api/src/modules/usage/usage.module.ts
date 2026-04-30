import { Module } from '@nestjs/common';
import { UsageController } from './usage.controller.js';
import { PrismaUsageRepo } from './usage.repo.js';
import { UsageService } from './usage.service.js';
import { USAGE_REPO_TOKEN } from './tokens.js';

/**
 * `UsageModule` — domain home for per-organization month-to-date usage
 * reads (tokens, cost, scan count, cap state). MVP-5 B6 / R-12.
 *
 * Spec: `sdd/scanner-vertical-ar/spec` R-11-CanScanThisMonth,
 *   R-12-UsageReadEndpoint, R-13-UsageWidget (consumer).
 * Design: `sdd/scanner-vertical-ar/design` ADR-11.
 *
 * **B6 (this commit) wires:**
 *   - `UsageController` mounted at `/org/:orgId/usage/current` (GET only —
 *     no mutations; `ScanLog` writes are owned exclusively by
 *     `apps/scanner` per INV-SP-1).
 *   - `USAGE_REPO_TOKEN` → `PrismaUsageRepo` (uses the global
 *     `PrismaModule.PRISMA_CLIENT`).
 *   - `UsageService` (read-only pass-through to the canonical
 *     `@regwatch/db/usage#getMonthlyUsage` helper — INV-UT-1: single
 *     source of truth shared with the scanner cap-gate).
 *
 * **B7 will add**: web-layer proxy route + `<UsageWidget />` component.
 *
 * NOT `@Global()`: nothing outside this module needs to inject
 * `UsageService` — future cross-cutting consumers (e.g. a cron-driven
 * quota-email job) should depend on the `getMonthlyUsage` helper directly,
 * not on the Nest service.
 *
 * Foot-gun #667: every consumer uses `@Inject(<symbol>)` — service +
 * controller constructors are explicit by symbol token.
 */
@Module({
  controllers: [UsageController],
  providers: [UsageService, { provide: USAGE_REPO_TOKEN, useClass: PrismaUsageRepo }],
  exports: [UsageService],
})
export class UsageModule {}
