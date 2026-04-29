import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient, type Settings } from '@regwatch/db/client';
import { DEFAULT_SETTINGS, type UpdateSettingsInput } from '@regwatch/types';
import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';
import { SETTINGS_REPO_TOKEN } from './tokens.js';

/**
 * Persistence boundary for the settings module.
 *
 * Three operations cover the full B2 surface:
 *
 *   - {@link findByOrgId}    — straight SELECT for the read path. Returns
 *     `null` when no row exists yet (the lazy-create case the service
 *     resolves via {@link upsertDefault}).
 *   - {@link upsertDefault}  — race-safe lazy-create on first GET. Uses
 *     `prisma.settings.upsert(...)` with an EMPTY `update: {}` so a
 *     concurrent caller that wins the unique-index race on
 *     `organizationId` does NOT clobber the row that already exists
 *     (foot-gun #645: rely on the unique index as the gate, never on a
 *     prior SELECT).
 *   - {@link replace}        — PUT semantics per design D8 (full replace,
 *     no PATCH). Single `UPDATE` keyed by `organizationId`; the row is
 *     guaranteed to exist by the controller flow (every `PUT` is
 *     preceded by `getOrCreate`).
 *
 * Foot-gun #667: explicit `@Inject(PRISMA_CLIENT)` on every constructor
 * param under tsx + NestJS DI.
 *
 * Spec: `sdd/jurisdictions-config/spec` R-Settings-Get-Or-Create,
 *   R-Settings-Update, R-Settings-Race-Safe.
 * Design: `sdd/jurisdictions-config/design` §0 D5 (DI), D8 (PUT only),
 *   §4 (DB shape — `scanSchedule String`, NOT a Postgres enum).
 */
export interface SettingsRepo {
  /**
   * Load the `Settings` row for `organizationId` — `null` when no row
   * exists yet. The service uses this read for the happy-path GET and
   * falls through to {@link upsertDefault} on `null`.
   */
  findByOrgId(organizationId: string): Promise<Settings | null>;

  /**
   * Race-safe lazy-create. If a row exists, returns it unchanged
   * (`update: {}`). Otherwise inserts {@link DEFAULT_SETTINGS} keyed by
   * `organizationId` and returns the new row.
   *
   * The unique constraint on `Settings.organizationId` is the race gate
   * (foot-gun #645): a concurrent caller that wins the INSERT does NOT
   * see the loser overwrite their row, because the empty-`update`
   * branch is a no-op SQL UPDATE that touches no columns.
   */
  upsertDefault(organizationId: string): Promise<Settings>;

  /**
   * Full-replace (per design D8 — no PATCH). Caller is responsible for
   * having validated `payload` via the canonical `UpdateSettingsSchema`
   * at the controller boundary; this repo trusts the shape.
   *
   * Lazy-creates if the row does not exist yet (spec scenario "PUT
   * lazily creates if missing"). Implemented via `prisma.settings.upsert`
   * keyed by `organizationId @unique`, so a standalone PUT (without a
   * preceding GET) is always safe AND race-safe under concurrent writes
   * (foot-gun #645: unique-index gate, not prior SELECT).
   */
  replace(organizationId: string, payload: UpdateSettingsInput): Promise<Settings>;
}

/**
 * Prisma-backed implementation of {@link SettingsRepo}.
 *
 * Holds no state of its own — the `PrismaClient` singleton is resolved
 * via DI (`PRISMA_CLIENT` token, provided by the global `PrismaModule`).
 * No transactional methods: B2 has no cross-row invariants. The single
 * write (`upsert` or `update`) is its own atomic unit.
 */
@Injectable()
export class PrismaSettingsRepo implements SettingsRepo {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findByOrgId(organizationId: string): Promise<Settings | null> {
    return this.prisma.settings.findUnique({
      where: { organizationId },
    });
  }

  async upsertDefault(organizationId: string): Promise<Settings> {
    return this.prisma.settings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        jurisdictions: DEFAULT_SETTINGS.jurisdictions as unknown as Prisma.InputJsonValue,
        scanSchedule: DEFAULT_SETTINGS.scanSchedule,
        scanDay: DEFAULT_SETTINGS.scanDay,
        scanHour: DEFAULT_SETTINGS.scanHour,
      },
      // Empty `update` is intentional — the lazy-create contract is
      // "create if missing, otherwise return existing untouched". A
      // concurrent caller winning the unique-index race MUST NOT have
      // their row clobbered by the loser (foot-gun #645).
      update: {},
    });
  }

  async replace(organizationId: string, payload: UpdateSettingsInput): Promise<Settings> {
    const data = {
      jurisdictions: payload.jurisdictions as unknown as Prisma.InputJsonValue,
      scanSchedule: payload.scanSchedule,
      scanDay: payload.scanDay,
      scanHour: payload.scanHour,
    };
    // Upsert (not update) so a standalone PUT — without a preceding GET —
    // lazily creates the row instead of throwing P2025. The unique index
    // on `organizationId` is the race gate (foot-gun #645): two concurrent
    // PUTs converge on a single row, last write wins on the columns.
    return this.prisma.settings.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
  }
}

// Convenience re-export so importers don't have to round-trip via
// `tokens.js` for the sole token they care about at this layer.
export { SETTINGS_REPO_TOKEN };
