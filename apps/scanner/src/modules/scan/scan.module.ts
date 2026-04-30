/**
 * MVP-5 ScanModule.
 *
 * B3 wires (this batch):
 *   - GEMINI_CLIENT          → factory reads `process.env.GOOGLE_API_KEY`,
 *                              throws clearly if missing (lazy, runtime).
 *   - JURISDICTION_SCANNER_FACTORY → `createJurisdictionScannerFactory(client)`
 *   - ROOT_AGENT_FACTORY     → `createRootAgent(jurisdictionScannerFactory)`
 *                              (token name kept per ADR-15; value is the
 *                              resolved RootAgent — DI factory IS the factory)
 *   - DEDUP_HELPER           → `{ dedupFindings }` value provider
 *   - SCAN_SERVICE           → ScanService class
 *
 *     IMPORTANT (PR review fix): SCAN_SERVICE uses `useExisting: ScanService`,
 *     not a separate `useClass`. Otherwise NestJS instantiates ScanService
 *     TWICE — one for the token, one for the class — each with its own
 *     `orgMutex` Map, breaking the per-org dedup invariant (ADR-6) for any
 *     consumer that ever injects `ScanService` directly. The class provider
 *     is registered FIRST, then SCAN_SERVICE aliases it via useExisting.
 *
 * B4 wires (this batch):
 *   - USAGE_HELPER           → `{ getMonthlyUsage }` from `@regwatch/db/usage`
 *   - COST_HELPER            → `{ computeCostFromUsageMetadata }` value provider
 *
 * B5 wires (this batch):
 *   - ScanSchedulerService   → `@Cron(EVERY_HOUR)` global tick (ADR-3).
 *   - ScanController         → `POST /scan/trigger` manual endpoint (ADR-10).
 *
 * Foot-gun #667 (tsx + NestJS DI): every provider uses an explicit token; the
 * NestJS class-token is allowed only for the framework-owned `EventEmitter2`
 * (NestJS guarantees its metadata).
 *
 * Spec: sdd/scanner-vertical-ar/spec  Design: sdd/scanner-vertical-ar/design ADR-2, ADR-15.
 */
import { Module } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

import {
  COST_HELPER,
  DEDUP_HELPER,
  GEMINI_CLIENT,
  JURISDICTION_SCANNER_FACTORY,
  ROOT_AGENT_FACTORY,
  SCAN_SERVICE,
  USAGE_HELPER,
} from './tokens.js';
import {
  createJurisdictionScannerFactory,
  type JurisdictionScannerFactory,
} from './agents/jurisdiction-scanner.factory.js';
import { createRootAgent } from './agents/root.agent.js';
import { dedupFindings } from './utils/dedup.helper.js';
import { computeCostFromUsageMetadata } from './utils/cost.helper.js';
import { getMonthlyUsage } from '@regwatch/db/usage';
import {
  ScanService,
  type CostHelper,
  type DedupHelper,
  type UsageHelper,
} from './scan.service.js';
import { ScanSchedulerService } from './scan-scheduler.service.js';
import { ScanController } from './scan.controller.js';

@Module({
  controllers: [ScanController],
  providers: [
    {
      provide: GEMINI_CLIENT,
      useFactory: (): GoogleGenAI => {
        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) {
          // Lazy throw at first injection — keeps unit tests free to override
          // GEMINI_CLIENT without setting the env var.
          throw new Error(
            'GOOGLE_API_KEY missing. Set it in apps/scanner/.env (Gemini API). ' +
              'Spec: sdd/scanner-vertical-ar/spec R-1-AdkTopology.',
          );
        }
        return new GoogleGenAI({ apiKey });
      },
    },
    {
      provide: JURISDICTION_SCANNER_FACTORY,
      inject: [GEMINI_CLIENT],
      useFactory: (client: GoogleGenAI): JurisdictionScannerFactory =>
        createJurisdictionScannerFactory(client),
    },
    {
      provide: ROOT_AGENT_FACTORY,
      inject: [JURISDICTION_SCANNER_FACTORY],
      useFactory: (factory: JurisdictionScannerFactory) => createRootAgent(factory),
    },
    {
      provide: DEDUP_HELPER,
      useValue: { dedupFindings } satisfies DedupHelper,
    },
    {
      provide: USAGE_HELPER,
      useValue: { getMonthlyUsage } satisfies UsageHelper,
    },
    {
      provide: COST_HELPER,
      useValue: { computeCostFromUsageMetadata } satisfies CostHelper,
    },
    // Order matters: register the class FIRST, then alias the token via
    // `useExisting` so both `@Inject(SCAN_SERVICE)` and direct `ScanService`
    // injections resolve to the SAME singleton (ADR-6 mutex invariant).
    ScanService,
    {
      provide: SCAN_SERVICE,
      useExisting: ScanService,
    },
    ScanSchedulerService,
  ],
  exports: [SCAN_SERVICE, DEDUP_HELPER, ROOT_AGENT_FACTORY, USAGE_HELPER, COST_HELPER],
})
export class ScanModule {}
