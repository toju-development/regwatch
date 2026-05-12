import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { ScanModule } from './modules/scan/scan.module.js';
import { EnrichmentModule } from './modules/enrichment/enrichment.module.js';
import { AuthModule } from './common/auth/auth.module.js';
import { env } from './env.js';

/**
 * Root module for `apps/scanner`.
 * Design: sdd/scanner-vertical-ar/design ADR-3 (cron) + ADR-14 (events).
 *       sdd/classifier-and-writer/design ADR-10 (EnrichmentModule wiring).
 *
 * - `ScheduleModule.forRoot()` enables `@Cron` discovery for `ScanScheduler`.
 * - `EventEmitterModule.forRoot()` powers `scan.completed` / `enrichment.completed`
 *   events. Registered ONCE here — do NOT add in child modules.
 * - `ScanModule` wires scanner agents, dedup, usage helper.
 * - `EnrichmentModule` wires Classifier + Writer pipeline (MVP-6).
 *
 * Auth guards live in `AuthModule` (Global). Per-route `@UseGuards(JwtAuthGuard,
 * RolesGuard)` on controllers — NOT registered as APP_GUARD because health
 * endpoints must remain unauthenticated.
 */
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL,
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        ...(env.NODE_ENV !== 'production' && { transport: { target: 'pino-pretty' } }),
      },
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    PrismaModule,
    AuthModule,
    HealthModule,
    ScanModule,
    EnrichmentModule,
  ],
})
export class AppModule {}
