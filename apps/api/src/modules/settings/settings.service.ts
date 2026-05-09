import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Settings } from '@regwatch/db/client';
import {
  SETTINGS_UPDATED_EVENT,
  type SettingsJurisdictions,
  type SettingsUpdatedEvent,
  type UpdateSettingsInput,
} from '@regwatch/types';
import { SETTINGS_REPO_TOKEN, type SettingsRepo } from './settings.repo.js';

/**
 * Settings domain service.
 *
 * **B2 (this batch)** lands two methods:
 *
 *   - {@link getOrCreate} — read-or-lazy-create the per-org `Settings`
 *     row for `GET /org/:orgId/settings`. Race-safe via
 *     `SettingsRepo.upsertDefault` (foot-gun #645).
 *   - {@link update}      — full-replace per design D8 (no PATCH).
 *     Emits `settings.updated` POST-commit (after the repo write
 *     resolves) so a downstream listener failure cannot roll back the
 *     persisted state. The MVP-12 `scheduler-per-org` consumer wires up
 *     to this event later — until then the emit is type-safe but
 *     unsubscribed.
 *
 * **B3 will add**: `SettingsController` (GET + PUT), `ZodBodyPipe`
 * wiring for `UpdateSettingsSchema`, and the `RolesGuard('OWNER','ADMIN')`
 * authorization chain.
 *
 * Foot-gun #667: explicit `@Inject(...)` for every constructor param
 * under tsx + NestJS DI (esbuild does NOT emit `design:paramtypes`).
 *
 * Spec: `sdd/jurisdictions-config/spec` R-Settings-Get-Or-Create,
 *   R-Settings-Update, R-Settings-Updated-Event.
 * Design: `sdd/jurisdictions-config/design` §0 D8 (PUT only),
 *   D13 (POST-commit emit), §5 (DI), §7 (event payload).
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @Inject(SETTINGS_REPO_TOKEN) private readonly repo: SettingsRepo,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  /**
   * Read the `Settings` row for `organizationId`, creating one with
   * `DEFAULT_SETTINGS` if none exists yet.
   *
   * Order:
   *   1. SELECT — happy path returns immediately when the row exists.
   *   2. INSERT (race-safe) — `repo.upsertDefault` tries `create` and,
   *      on `P2002` (concurrent caller won the unique-index race on
   *      `organizationId`), re-reads the winner's row. Foot-gun #645:
   *      the unique index is the gate, NOT the prior SELECT — two
   *      callers seeing `null` here is fine, exactly one wins the
   *      INSERT and the other recovers via the P2002 branch.
   *
   * The two-step (SELECT-then-create) is intentional: the steady-state
   * cost is ONE SELECT per request; only the rare first-GET pays the
   * INSERT round-trip. Skipping straight to `upsertDefault` would issue
   * a write attempt on every call.
   */
  async getOrCreate(organizationId: string): Promise<Settings> {
    const existing = await this.repo.findByOrgId(organizationId);
    if (existing) return existing;
    return this.repo.upsertDefault(organizationId);
  }

  /**
   * Full-replace the settings row and emit `settings.updated` POST-commit.
   *
   * Order:
   *   1. `repo.replace(...)` — single UPDATE keyed by `organizationId`.
   *      Awaiting this resolves once Postgres has committed.
   *   2. Build the typed event payload from the persisted row's
   *      `updatedAt` (NOT `new Date()`) so the timestamp matches what
   *      callers will see on a subsequent GET.
   *   3. `this.events.emit(...)` — synchronous in-process dispatch via
   *      EventEmitter2. The emit is wrapped in try/catch + log so a
   *      throwing listener cannot bubble up and turn a successful
   *      persist into a 500 (design D13: the row is committed and the
   *      caller MUST see success). The wrap is intentionally narrow —
   *      ONLY the emit is guarded, never the repo write.
   *
   * If `repo.replace` throws, the emit MUST NOT fire — the early throw
   * exits the method before the emit, so no extra try/catch is needed
   * for that branch. The unit suite asserts this with a rejecting repo
   * mock + an `expect(events.emit).not.toHaveBeenCalled()`.
   *
   * Caller (B3 controller) is responsible for the auth chain
   * (`JwtAuthGuard` → `MembershipFreshnessGuard` → `OrgScopeGuard` →
   * `RolesGuard('OWNER','ADMIN')`) AND for having validated `payload`
   * via `ZodBodyPipe`. This service trusts both contracts.
   */
  async update(
    organizationId: string,
    payload: UpdateSettingsInput,
    actorId: string,
  ): Promise<Settings> {
    const saved = await this.repo.replace(organizationId, payload);
    const evt: SettingsUpdatedEvent = {
      organizationId,
      actorId,
      jurisdictions: saved.jurisdictions as unknown as SettingsJurisdictions,
      scanSchedule: saved.scanSchedule as SettingsUpdatedEvent['scanSchedule'],
      scanDay: saved.scanDay,
      scanHour: saved.scanHour,
      scanDayOfMonth: saved.scanDayOfMonth ?? null,
      updatedAt: saved.updatedAt.toISOString(),
    };
    try {
      this.events.emit(SETTINGS_UPDATED_EVENT, evt);
    } catch (err) {
      // Design D13: the row is committed; a listener throw MUST NOT
      // bubble out and surface as 500 to the caller. Log and continue.
      this.logger.error(
        `settings.updated listener threw for org=${organizationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return saved;
  }

  /**
   * Mark onboarding as completed for `organizationId`.
   *
   * Called by `PATCH /org/:orgId/settings` (MVP-11 onboarding wizard).
   * The `completedAt` timestamp comes from the client (ISO string parsed
   * server-side) so the record reflects when the user actually clicked
   * "Finish" / "Skip all". The repo does a minimal UPDATE touching only
   * `onboardingCompletedAt` and `updatedAt`.
   *
   * Idempotent — calling twice is safe (last write wins, same effect).
   */
  async completeOnboarding(organizationId: string, completedAt: Date): Promise<Settings> {
    return this.repo.setOnboardingCompleted(organizationId, completedAt);
  }
}
