import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { ScanModule } from './modules/scan/scan.module.js';
import { AuthModule } from './common/auth/auth.module.js';

/**
 * MVP-5 root module for `apps/scanner`.
 * Design: sdd/scanner-vertical-ar/design ADR-3 (cron) + ADR-14 (events).
 *
 * - `ScheduleModule.forRoot()` enables `@Cron` discovery for `ScanScheduler` (B5).
 * - `EventEmitterModule.forRoot()` powers `scan.completed` post-commit emit (B5/B3).
 * - `ScanModule` is the placeholder shell; providers populated in B3-B5.
 *
 * Auth guards live in `AuthModule` (Global). Per-route `@UseGuards(JwtAuthGuard,
 * RolesGuard)` on `ScanController` — NOT registered as APP_GUARD because
 * health endpoints must remain unauthenticated.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    PrismaModule,
    AuthModule,
    HealthModule,
    ScanModule,
  ],
})
export class AppModule {}
