import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';
import { ScanModule } from './scan.module.js';
import { GEMINI_CLIENT, SCAN_SERVICE } from './tokens.js';

/**
 * MVP-5 smoke test: ScanModule must instantiate without DI errors.
 * Catches wiring breakage early as B3/B4/B5 add providers.
 *
 * - `GEMINI_CLIENT` is overridden — production factory throws when
 *   `GOOGLE_API_KEY` is missing (kept env-free for CI/local).
 * - `PRISMA_CLIENT` is provided by a `@Global()` stub module so the
 *   real `PrismaModule` (which needs `DATABASE_URL`) stays out of this
 *   isolated module test.
 *
 * Design: sdd/scanner-vertical-ar/design ADR-15 (tsx + DI foot-gun #667).
 */
@Global()
@Module({
  providers: [{ provide: PRISMA_CLIENT, useValue: {} }],
  exports: [PRISMA_CLIENT],
})
class StubPrismaModule {}

describe('ScanModule', () => {
  it('compiles as an isolated NestJS module shell', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot(), StubPrismaModule, ScanModule],
    })
      .overrideProvider(GEMINI_CLIENT)
      .useValue({ models: { generateContent: async () => ({ text: '{"findings":[]}' }) } })
      .compile();

    expect(moduleRef.get(ScanModule)).toBeInstanceOf(ScanModule);
    expect(moduleRef.get(SCAN_SERVICE)).toBeDefined();
    await moduleRef.close();
  });
});
