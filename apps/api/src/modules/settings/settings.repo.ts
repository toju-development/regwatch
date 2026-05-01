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
 *   - {@link upsertDefault}  — race-safe lazy-create on first GET.
 *     Tries `prisma.settings.create(...)` and, on `P2002` (unique
 *     violation on `organizationId`), re-reads the winner's row via
 *     `findUnique`. The unique index is the race gate (foot-gun #645:
 *     never gate on a prior SELECT). See the inline comment on the
 *     method body for why `prisma.upsert(... update: {})` is NOT atomic
 *     and was rejected.
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
   * Race-safe lazy-create. Inserts {@link DEFAULT_SETTINGS} keyed by
   * `organizationId`; if a concurrent caller wins the unique-index race
   * (Prisma `P2002` on `Settings.organizationId`), re-reads and returns
   * the winner's row instead of throwing.
   *
   * The unique constraint is the race gate (foot-gun #645: never gate
   * on a prior SELECT). See the inline comment on the implementation
   * for why `prisma.upsert(... update: {})` is NOT atomic and was
   * rejected in favor of try-create / catch-P2002 / find.
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
    // Why not `prisma.upsert(... update: {})`?
    //
    // Prisma compiles `upsert` with an empty `update` clause to a
    // best-effort SELECT-then-INSERT pattern (NOT atomic
    // `INSERT ... ON CONFLICT DO UPDATE` — the ON CONFLICT branch needs
    // a non-empty update SET). Under N concurrent first-GETs for the
    // same orgId, all N may race past the SELECT, all N attempt
    // INSERT, one wins, the rest throw P2002 (unique-index violation
    // on `Settings.organizationId`) which surfaces as 500.
    //
    // Reproduced by `R-Settings-Race-Safe — 5 concurrent first-GETs`
    // under full-suite parallel load (every ~15 vitest runs).
    //
    // Fix: try INSERT first; on P2002, re-fetch the winner's row.
    // Both branches are race-safe via the unique index (foot-gun #645).
    try {
      return await this.prisma.settings.create({
        data: {
          organizationId,
          jurisdictions: DEFAULT_SETTINGS.jurisdictions as unknown as Prisma.InputJsonValue,
          scanSchedule: DEFAULT_SETTINGS.scanSchedule,
          scanDay: DEFAULT_SETTINGS.scanDay,
          scanHour: DEFAULT_SETTINGS.scanHour,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // A concurrent caller won the INSERT — re-read their row.
        // `findUnique` MUST find it: the unique index is the gate, and
        // the winner's transaction has committed by the time we see
        // P2002 in PostgreSQL READ COMMITTED.
        const winner = await this.prisma.settings.findUnique({
          where: { organizationId },
        });
        if (winner) return winner;
      }
      throw err;
    }
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
