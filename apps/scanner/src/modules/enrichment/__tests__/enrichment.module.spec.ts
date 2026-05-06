/**
 * DI singleton smoke test for `EnrichmentModule`.
 *
 * Guards against foot-gun #738: double-instantiation when `useClass` is used
 * instead of `useExisting`. If `EnrichmentService` were registered with
 * `{ provide: ENRICHMENT_SERVICE, useClass: EnrichmentService }`, NestJS would
 * create TWO instances — one for the class token, one for the symbol token —
 * silently breaking any shared state between them.
 *
 * This test asserts strict reference equality (`toBe`) to catch that scenario.
 *
 * Spec: sdd/classifier-and-writer/spec. Design: ADR-10 (DI tokens, useExisting).
 */
import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { describe, expect, it } from 'vitest';

import { PRISMA_CLIENT } from '../../../common/prisma/prisma.token.js';
import { USAGE_HELPER } from '../../scan/tokens.js';
import { CLASSIFIER_AGENT_FACTORY, ENRICHMENT_SERVICE, WRITER_AGENT_FACTORY } from '../tokens.js';
import { EnrichmentModule } from '../enrichment.module.js';
import { EnrichmentService } from '../enrichment.service.js';
import { EnrichmentListener } from '../enrichment.listener.js';

// ─── Stubs ────────────────────────────────────────────────────────────────────

// Internal token defined in enrichment.module.ts — must match Symbol.for key.
const ENRICHMENT_GEMINI_CLIENT = Symbol.for('regwatch.enrichment.GEMINI_CLIENT');

const stubPrisma = { alert: {}, enrichmentLog: {}, settings: {} };
const stubUsageHelper = { getMonthlyUsage: () => Promise.resolve({}) };
const stubClassifierFactory = () => ({ model: 'stub', call: async () => ({}) });
const stubWriterFactory = () => ({ model: 'stub', call: async () => ({}) });

/**
 * Fake @Global() module that mimics PrismaModule for testing.
 * PRISMA_CLIENT is @Global in production — EnrichmentModule does not import
 * PrismaModule directly, it relies on the global registry.
 */
@Global()
@Module({
  providers: [{ provide: PRISMA_CLIENT, useValue: stubPrisma }],
  exports: [PRISMA_CLIENT],
})
class FakePrismaModule {}

async function buildTestModule() {
  return Test.createTestingModule({
    imports: [FakePrismaModule, EventEmitterModule.forRoot(), EnrichmentModule],
  })
    .overrideProvider(ENRICHMENT_GEMINI_CLIENT)
    .useValue({ stub: 'gemini' })
    .overrideProvider(USAGE_HELPER)
    .useValue(stubUsageHelper)
    .overrideProvider(CLASSIFIER_AGENT_FACTORY)
    .useValue(stubClassifierFactory)
    .overrideProvider(WRITER_AGENT_FACTORY)
    .useValue(stubWriterFactory)
    .compile();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EnrichmentModule — DI singleton guard (foot-gun #738)', () => {
  it('EnrichmentService resolves as singleton — useExisting guard against foot-gun #738', async () => {
    const moduleRef = await buildTestModule();

    const byClass = moduleRef.get(EnrichmentService);
    const byToken = moduleRef.get<EnrichmentService>(ENRICHMENT_SERVICE);

    // Strict reference equality — same instance, NOT two separate objects.
    expect(byClass).toBe(byToken);
  });

  it('EnrichmentListener is resolvable from the module', async () => {
    const moduleRef = await buildTestModule();

    const listener = moduleRef.get(EnrichmentListener);

    expect(listener).toBeDefined();
    expect(listener).toBeInstanceOf(EnrichmentListener);
  });

  it('EventEmitter2 is resolvable (needed for listener to emit enrichment.completed)', async () => {
    const moduleRef = await buildTestModule();

    const emitter = moduleRef.get(EventEmitter2);

    expect(emitter).toBeDefined();
  });
});
