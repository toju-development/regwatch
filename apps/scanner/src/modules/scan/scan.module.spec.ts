import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { ScanModule } from './scan.module.js';

/**
 * MVP-5 smoke test: ScanModule must instantiate without DI errors.
 * Catches wiring breakage early as B3/B4/B5 add providers.
 * Design: sdd/scanner-vertical-ar/design ADR-15 (tsx + DI foot-gun #667).
 */
describe('ScanModule', () => {
  it('compiles as an isolated NestJS module shell', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ScanModule],
    }).compile();

    expect(moduleRef.get(ScanModule)).toBeInstanceOf(ScanModule);
    await moduleRef.close();
  });
});
