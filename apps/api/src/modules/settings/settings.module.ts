import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service.js';
import { PrismaSettingsRepo } from './settings.repo.js';
import { SETTINGS_REPO_TOKEN } from './tokens.js';

/**
 * `SettingsModule` — domain home for per-organization Settings reads
 * and writes (jurisdictions config + scan cadence).
 *
 * Spec: `sdd/jurisdictions-config/spec`.
 * Design: `sdd/jurisdictions-config/design` §0 D5 (DI), §5.
 *
 * **B2 (this commit) wires:**
 *   - `SETTINGS_REPO_TOKEN` → `PrismaSettingsRepo` (uses the global
 *     `PrismaModule.PRISMA_CLIENT`).
 *   - `SettingsService` (consumes `EventEmitter2` from the root
 *     `EventEmitterModule.forRoot()` registered in `AppModule`).
 *
 * **B3 will add**: `SettingsController` (GET + PUT routes), startup
 * validator (if any cadence env knobs land), and the controller-level
 * `RolesGuard('OWNER','ADMIN')` chain.
 *
 * NOT `@Global()`: nothing outside this module needs to inject
 * `SettingsService` — the future MVP-12 scheduler subscribes to the
 * `settings.updated` event payload, NOT the service instance.
 *
 * Foot-gun #667: every consumer uses `@Inject(<symbol>)` — service
 * constructor is explicit by symbol token.
 */
@Module({
  providers: [SettingsService, { provide: SETTINGS_REPO_TOKEN, useClass: PrismaSettingsRepo }],
  exports: [SettingsService],
})
export class SettingsModule {}
