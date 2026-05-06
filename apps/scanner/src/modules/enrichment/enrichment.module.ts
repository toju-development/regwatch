/**
 * EnrichmentModule — MVP-6 DI wiring for the Classifier + Writer pipeline.
 *
 * Mirrors `scan.module.ts` structure exactly.
 *
 * Provider registration order (critical for `useExisting` foot-gun #738):
 *   1. GEMINI_CLIENT          → reads `process.env.GOOGLE_API_KEY` at injection time
 *   2. CLASSIFIER_AGENT_FACTORY → `createClassifierAgentFactory(client)` result
 *   3. WRITER_AGENT_FACTORY   → `createWriterAgentFactory(client)` result
 *   4. USAGE_HELPER           → `{ getMonthlyUsage }` value provider (same token
 *                               as ScanModule — provided here for module isolation)
 *   5. EnrichmentService      → class registered FIRST
 *   6. ENRICHMENT_SERVICE     → `useExisting: EnrichmentService` (NOT useClass —
 *                               same singleton; avoids double-instantiation #738)
 *   7. EnrichmentListener     → `@OnEvent(SCAN_COMPLETED_EVENT)` handler
 *
 * Foot-gun #738: `useExisting` instead of `useClass` for `ENRICHMENT_SERVICE`.
 *   If `useClass` were used, NestJS would create TWO `EnrichmentService` instances
 *   — one for the class token, one for the symbol token. The `EnrichmentListener`
 *   would hold a DIFFERENT instance than any direct `EnrichmentService` injection,
 *   silently breaking any shared state. `useExisting` aliases to the same singleton.
 *
 * Foot-gun #667 (tsx + NestJS DI): `EventEmitter2` is injected by class token
 *   only because NestJS guarantees its metadata via `EventEmitterModule`. All
 *   other providers use explicit Symbol tokens.
 *
 * Spec: sdd/classifier-and-writer/spec. Design: ADR-3, ADR-10.
 */
import { Module } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

import { getMonthlyUsage } from '@regwatch/db/usage';

import { USAGE_HELPER } from '../scan/tokens.js';
import { CLASSIFIER_AGENT_FACTORY, ENRICHMENT_SERVICE, WRITER_AGENT_FACTORY } from './tokens.js';
import {
  createClassifierAgentFactory,
  type ClassifierAgentFactory,
} from './agents/classifier.factory.js';
import { createWriterAgentFactory, type WriterAgentFactory } from './agents/writer.factory.js';
import { EnrichmentService, type UsageHelper } from './enrichment.service.js';
import { EnrichmentListener } from './enrichment.listener.js';
import { EnrichmentSweeper } from './enrichment.sweeper.js';

// Internal token — GEMINI_CLIENT for the enrichment module only.
// ScanModule does not export its GEMINI_CLIENT, so we create our own.
const ENRICHMENT_GEMINI_CLIENT = Symbol.for('regwatch.enrichment.GEMINI_CLIENT');

@Module({
  providers: [
    {
      provide: ENRICHMENT_GEMINI_CLIENT,
      useFactory: (): GoogleGenAI => {
        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) {
          throw new Error(
            'GOOGLE_API_KEY missing. Set it in apps/scanner/.env (Gemini API). ' +
              'Spec: sdd/classifier-and-writer/spec R-1, R-2.',
          );
        }
        return new GoogleGenAI({ apiKey });
      },
    },
    {
      provide: CLASSIFIER_AGENT_FACTORY,
      inject: [ENRICHMENT_GEMINI_CLIENT],
      useFactory: (client: GoogleGenAI): ClassifierAgentFactory =>
        createClassifierAgentFactory(client),
    },
    {
      provide: WRITER_AGENT_FACTORY,
      inject: [ENRICHMENT_GEMINI_CLIENT],
      useFactory: (client: GoogleGenAI): WriterAgentFactory => createWriterAgentFactory(client),
    },
    {
      provide: USAGE_HELPER,
      useValue: { getMonthlyUsage } satisfies UsageHelper,
    },
    // Order matters: class FIRST, then alias via useExisting (foot-gun #738).
    EnrichmentService,
    {
      provide: ENRICHMENT_SERVICE,
      useExisting: EnrichmentService,
    },
    EnrichmentListener,
    EnrichmentSweeper,
  ],
  exports: [EnrichmentService, ENRICHMENT_SERVICE],
})
export class EnrichmentModule {}
