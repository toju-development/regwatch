import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from './health/health.module.js';
import { ScanModule } from './modules/scan/scan.module.js';

/**
 * MVP-5 root module for `apps/scanner`.
 * Design: sdd/scanner-vertical-ar/design ADR-3 (cron) + ADR-14 (events).
 *
 * - `ScheduleModule.forRoot()` enables `@Cron` discovery for `ScanScheduler` (B5).
 * - `EventEmitterModule.forRoot()` powers `scan.completed` post-commit emit (B5/B3).
 * - `ScanModule` is the placeholder shell; providers populated in B3-B5.
 *
 * Auth guards (4-guard chain for `POST /scan/trigger`) are intentionally NOT
 * registered yet — copy-paste deferred to B5 when the controller lands so we
 * only import what the controller actually consumes (avoid dead wiring).
 */
@Module({
  imports: [ScheduleModule.forRoot(), EventEmitterModule.forRoot(), HealthModule, ScanModule],
})
export class AppModule {}
