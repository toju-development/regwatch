/**
 * Body schema for `PUT /org/:orgId/settings` (B3 controller).
 *
 * Re-exports the canonical `UpdateSettingsSchema` from `@regwatch/types`
 * so the API never owns a parallel-but-divergent copy of the contract
 * shared with `apps/web` (form) and `apps/scanner` (consumer of
 * `Settings.jurisdictions`).
 *
 * Spec: `sdd/jurisdictions-config/spec` R-Settings-Schema, R-Settings-Validation.
 * Design: `sdd/jurisdictions-config/design` §0 D6 (single source of
 *   schema), §6 (PUT = full replace, no PATCH per D8).
 *
 * Validation runs at the `ZodBodyPipe` layer in B3 — `SettingsService.update`
 * trusts the parsed shape (`UpdateSettingsInput`) and never re-validates.
 * Pushing `INVALID_*` codes into HTTP 400 is the pipe's job; the schema's
 * cross-row invariants (`EMPTY_JURISDICTIONS`, `NO_ENABLED_JURISDICTION`,
 * `DUPLICATE_JURISDICTION_CODE`, `WEEKLY_REQUIRES_SINGLE_DAY`) surface as
 * `error` strings on individual Zod issues.
 */
export { UpdateSettingsSchema, type UpdateSettingsInput } from '@regwatch/types';
