import { Controller, Get, HttpCode, Inject, NotFoundException, Post } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator.js';
import { MemoryEmailAdapter } from './memory-email.adapter.js';
import type { EmailMessage } from './email.port.js';

/**
 * DEV/TEST-ONLY controller exposing the {@link MemoryEmailAdapter}
 * inbox over HTTP for Playwright assertions.
 *
 * Spec: `sdd/org-invitations/spec` R-Email-Port-Hexagonal (E2E inbox
 *   query API).
 * Design: `sdd/org-invitations/design` D13 (double-guarded test inbox).
 *
 * **Double guard** (defense-in-depth):
 *
 *   1. Module-level: `EmailModule` only registers this controller when
 *      `NODE_ENV !== 'production' && process.env.EMAIL_TRANSPORT === 'memory'`.
 *      In production builds, the controller is NEVER mounted — the
 *      route returns Nest's default 404.
 *   2. Handler-level: every method re-evaluates the same env predicate
 *      and throws {@link NotFoundException} if it ever fails. This
 *      catches the (unlikely but possible) hot-reload edge where env
 *      flips after boot. **404 (not 403)** so we never leak the
 *      controller's existence.
 *
 * Foot-gun #667 (tsx + NestJS DI no decorator metadata): the constructor
 * uses an explicit `@Inject(MemoryEmailAdapter)` — even though it's a
 * class type, the explicit token sidesteps the missing
 * `design:paramtypes` metadata that breaks default class-type injection
 * under tsx.
 *
 * Routes (mounted only when guard passes):
 *
 *   - `GET  /test/email-inbox`       → `EmailMessage[]` (every send so far)
 *   - `POST /test/email-inbox/clear` → 204, drops every entry
 *
 * Both decorated `@Public()` so the global `JwtAuthGuard` skips them.
 */
@Controller('test/email-inbox')
export class TestInboxController {
  constructor(@Inject(MemoryEmailAdapter) private readonly adapter: MemoryEmailAdapter) {}

  /**
   * Snapshot of every message that has been sent through the in-memory
   * adapter since the last `clear()`.
   */
  @Public()
  @Get()
  list(): EmailMessage[] {
    this.assertEnabled();
    return this.adapter.getSent();
  }

  /**
   * Reset the inbox (Playwright `beforeEach` hook).
   */
  @Public()
  @Post('clear')
  @HttpCode(204)
  clear(): void {
    this.assertEnabled();
    this.adapter.clear();
  }

  /**
   * Re-evaluates the env guard at call time.
   *
   * Throws {@link NotFoundException} (NOT `ForbiddenException`) so a
   * production deployment that accidentally registered this controller
   * still does not leak the route's existence. Aligns with D13 wording
   * "Returns 404 (NOT 403 — don't leak existence) when guard fails".
   */
  private assertEnabled(): void {
    if (process.env.NODE_ENV === 'production' || process.env.EMAIL_TRANSPORT !== 'memory') {
      throw new NotFoundException();
    }
  }
}
