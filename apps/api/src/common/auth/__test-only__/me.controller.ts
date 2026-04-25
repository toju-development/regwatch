import { Controller, Get } from '@nestjs/common';
import type { AuthUser } from '@regwatch/types';
import { CurrentUser } from '../current-user.decorator.js';

/**
 * Test-only protected endpoint used by Playwright in MVP-3a (B6).
 *
 * Spec: `sdd/auth-foundation/spec` § auth — R "Protected API Route via JwtAuthGuard"
 *   S "Valid token authorizes" / "Missing/invalid → 401".
 *
 * Mounted ONLY when `NODE_ENV !== 'production'` (see `app.module.ts`).
 * NOT marked `@Public()` — this is the canary that proves the global
 * `JwtAuthGuard` actually rejects unauthenticated requests and accepts
 * valid Bearer tokens minted by `apps/web`.
 *
 * The route is NOT a long-term public API — when MVP-3b ships real protected
 * routes, this controller can be deleted along with `TestOnlyModule`.
 */
@Controller('_test')
export class MeController {
  @Get('me')
  me(@CurrentUser() user: AuthUser | undefined): { user: AuthUser | undefined } {
    return { user };
  }
}
