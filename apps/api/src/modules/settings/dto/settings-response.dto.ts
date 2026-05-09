import type { Settings } from '@regwatch/db/client';
import type { SettingsJurisdictions, UpdateSettingsInput } from '@regwatch/types';

/**
 * Wire shape for `GET /org/:orgId/settings` and `PUT /org/:orgId/settings`
 * (B3 controller).
 *
 * Mirrors the Prisma `Settings` row with two transport-layer concerns
 * baked in:
 *
 *   1. `updatedAt` is serialized as an ISO-8601 string (Date is not a
 *      JSON primitive — every other DTO in this codebase normalizes the
 *      same way; see `MemberListEntryDto.joinedAt`,
 *      `InvitationListEntryDto.expiresAt`).
 *   2. `jurisdictions` is widened from Prisma's opaque `JsonValue` back
 *      to the canonical {@link SettingsJurisdictions} (the shape
 *      validated by `UpdateSettingsSchema` at the body pipe). The cast
 *      is sound because the only writer is `SettingsService.update`,
 *      which has already validated the payload through the same
 *      schema (foot-gun #645 — single source of truth for the shape).
 *
 * Spec: `sdd/jurisdictions-config/spec` R-Settings-Get-Or-Create,
 *   R-Settings-Update.
 * Design: `sdd/jurisdictions-config/design` §6 (wire shape), §0 D6
 *   (single schema source).
 */
export interface SettingsDto {
  organizationId: string;
  jurisdictions: SettingsJurisdictions;
  scanSchedule: UpdateSettingsInput['scanSchedule'];
  scanDay: string;
  scanHour: number;
  scanDayOfMonth: number | null;
  updatedAt: string;
  /** ISO-8601 timestamp when onboarding was completed, or null if not yet done. */
  onboardingCompletedAt: string | null;
}

/**
 * Wrapped response envelope. Mirrors `{ members: [...] }` and
 * `{ invitations: [...] }` so the web client's response-shape contract
 * stays uniform across the org-scoped endpoints.
 */
export interface SettingsResponseDto {
  settings: SettingsDto;
}

/**
 * Map a persisted `Settings` row to the wire DTO. Pure function, safe to
 * call from both the GET and PUT handlers without re-reading.
 */
export function toSettingsDto(row: Settings): SettingsDto {
  return {
    organizationId: row.organizationId,
    jurisdictions: row.jurisdictions as unknown as SettingsJurisdictions,
    scanSchedule: row.scanSchedule as UpdateSettingsInput['scanSchedule'],
    scanDay: row.scanDay,
    scanHour: row.scanHour,
    scanDayOfMonth: row.scanDayOfMonth ?? null,
    updatedAt: row.updatedAt.toISOString(),
    onboardingCompletedAt: row.onboardingCompletedAt?.toISOString() ?? null,
  };
}
