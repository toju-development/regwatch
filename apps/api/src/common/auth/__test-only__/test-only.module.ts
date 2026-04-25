import { Module } from '@nestjs/common';
import { MeController } from './me.controller.js';

/**
 * Test-only module — mounted in `AppModule` only when `NODE_ENV !== 'production'`.
 *
 * Hosts ephemeral routes used by Playwright (B6 / MVP-3a). Delete this
 * directory when real protected routes land in MVP-3b and the canary is
 * no longer needed.
 */
@Module({
  controllers: [MeController],
})
export class TestOnlyModule {}
