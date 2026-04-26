import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AuthStartupValidator } from '../auth-startup.validator.js';
import { Roles } from '../decorators/roles.decorator.js';
import { Public } from '../public.decorator.js';

/**
 * Spec: `sdd/auth-authorization-guards/spec` R "Guard Registration Order
 * Is Contract" (extension: degenerate `@Public() + @Roles()` combo MUST
 * be rejected at bootstrap).
 * Design: `sdd/auth-authorization-guards/design` §1 (startup validation).
 *
 * `AuthStartupValidator` is the unit under test (extracted from
 * `AuthModule` so tests don't have to bring up `JwtVerifier`/env). We
 * compose ad-hoc test modules: a `DiscoveryModule` import + the
 * controller(s) under test + the validator as a provider.
 */

// Disable ESLint's class-methods-use-this and similar — these are
// scaffolding controllers used purely for metadata discovery.

@Controller('bad')
class BadController {
  @Public()
  @Roles('OWNER')
  @Get()
  bad(): { ok: true } {
    return { ok: true };
  }
}

@Controller('good')
class GoodController {
  @Public()
  @Get('public')
  pub(): { ok: true } {
    return { ok: true };
  }

  @Roles('OWNER')
  @Get('roles')
  rolesOnly(): { ok: true } {
    return { ok: true };
  }

  @Get('default')
  byDefault(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [DiscoveryModule],
  controllers: [BadController],
  providers: [AuthStartupValidator],
})
class BadModule {}

@Module({
  imports: [DiscoveryModule],
  controllers: [GoodController],
  providers: [AuthStartupValidator],
})
class GoodModule {}

describe('AuthStartupValidator', () => {
  it('throws on init when a handler combines @Public() and @Roles()', async () => {
    const module = await Test.createTestingModule({ imports: [BadModule] }).compile();
    try {
      await expect(module.init()).rejects.toThrow(/BadController\.bad/);
    } finally {
      // `module.close()` re-triggers lifecycle hooks; swallow any cleanup
      // error since the rejection above is the assertion under test.
      await module.close().catch(() => undefined);
    }
  });

  it('does not throw when @Public() and @Roles() live on different handlers', async () => {
    const module = await Test.createTestingModule({ imports: [GoodModule] }).compile();
    try {
      await expect(module.init()).resolves.toBeDefined();
    } finally {
      await module.close().catch(() => undefined);
    }
  });
});
