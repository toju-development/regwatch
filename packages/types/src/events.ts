/**
 * Cross-module event payloads emitted via `EventEmitter2` in `apps/api`.
 *
 * Spec: `sdd/jurisdictions-config/spec` R-Settings-Updated-Event.
 * Design: `sdd/jurisdictions-config/design` §0 D13, §7.
 *
 * Listener wiring lands in MVP-12 (`scheduler-per-org`). Until then the
 * payload is emitted POST-commit with no consumer — type-safe so the
 * future `@OnEvent(SETTINGS_UPDATED_EVENT)` handler has a typed contract.
 */
import { z } from 'zod';

import {
  ScanDaySchema,
  ScanHourSchema,
  ScanScheduleSchema,
  SettingsJurisdictionsSchema,
} from './settings.js';

/** Canonical event name. Use this constant — never the bare string. */
export const SETTINGS_UPDATED_EVENT = 'settings.updated' as const;

export const SettingsUpdatedEventSchema = z.object({
  organizationId: z.string().min(1),
  actorId: z.string().min(1),
  jurisdictions: SettingsJurisdictionsSchema,
  scanSchedule: ScanScheduleSchema,
  scanDay: ScanDaySchema,
  scanHour: ScanHourSchema,
  /** ISO-8601 timestamp (`Date.toISOString()`). */
  updatedAt: z.iso.datetime(),
});

export type SettingsUpdatedEvent = z.infer<typeof SettingsUpdatedEventSchema>;
