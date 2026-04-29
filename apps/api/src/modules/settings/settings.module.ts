import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller.js';
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
 * **B3 (this commit) wires:**
 *   - `SettingsController` mounted at `/org/:orgId/settings` (GET + PUT
 *     per design D8 — full replace, no PATCH).
 *   - `SETTINGS_REPO_TOKEN` → `PrismaSettingsRepo` (uses the global
 *     `PrismaModule.PRISMA_CLIENT`).
 *   - `SettingsService` (consumes `EventEmitter2` from the root
 *     `EventEmitterModule.forRoot()` registered in `AppModule`).
 *
 * **B4 will add**: any cadence env-knob startup validator (currently
 * none planned) and downstream MVP-12 scheduler subscriptions.
 *
 * NOT `@Global()`: nothing outside this module needs to inject
 * `SettingsService` — the future MVP-12 scheduler subscribes to the
 * `settings.updated` event payload, NOT the service instance.
 *
 * Foot-gun #667: every consumer uses `@Inject(<symbol>)` — service
 * constructor is explicit by symbol token.
 */
@Module({
  controllers: [SettingsController],
  providers: [SettingsService, { provide: SETTINGS_REPO_TOKEN, useClass: PrismaSettingsRepo }],
  exports: [SettingsService],
})
export class SettingsModule {}
