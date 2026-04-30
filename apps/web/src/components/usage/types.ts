/**
 * Wire shape for `GET /api/org/[orgId]/usage/current` — mirrors
 * `apps/api/src/modules/usage/dto/usage-response.dto.ts` (B6).
 *
 * Re-declared here to avoid a transitive dep on `apps/api` types
 * (mirrors `apps/web/src/app/(dashboard)/settings/preferences/page.tsx`'s
 * inline `SettingsWire` interface). `apps/web` does NOT import from
 * `apps/api` — they are sibling deployables.
 *
 * Decimal fields (`costUsd`, `capUsd`) are wire-serialized strings per
 * R-12 ("Decimal serialized as string") and INV-SP-3 (`Prisma.Decimal`
 * end-to-end on the server). Display code MUST `Number.parseFloat` for
 * presentation only and never feed back into arithmetic.
 *
 * `percent` is integer 0..100 — clamped at the apps/api DTO boundary
 * even when the helper's raw value exceeds 100 (ADR-6 mid-scan
 * over-shoot, foot-gun carry-forward #11).
 */
export interface UsageWireMonth {
  tokensUsed: number;
  costUsd: string;
  scansCount: number;
  capUsd: string;
  percent: number;
  monthStart: string;
}

export interface UsageResponseDto {
  currentMonth: UsageWireMonth;
  isAtCap: boolean;
}
