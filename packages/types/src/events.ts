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
import { ALERT_STATUS_VALUES } from './collaboration.js';

// ─── Scanner: scan.completed ────────────────────────────────────────────────

/**
 * Canonical event name emitted POST-commit by `ScanService.runScan`.
 *
 * Spec: `sdd/scanner-vertical-ar/spec` R-10-ScanCompletedEvent.
 * Design: `sdd/scanner-vertical-ar/design` ADR-14.
 *
 * Listener wiring lands in MVP-9 (`notify-slack`). Until then the payload
 * is emitted with no consumer — type-safe so the future
 * `@OnEvent(SCAN_COMPLETED_EVENT)` handler has a typed contract.
 */
export const SCAN_COMPLETED_EVENT = 'scan.completed' as const;

/**
 * Terminal `ScanLog.status` values eligible for emission. RUNNING/PENDING are
 * NOT broadcast (lifecycle events deferred per ADR-14).
 */
export const ScanCompletedStatusSchema = z.enum(['COMPLETED', 'FAILED', 'SKIPPED_CAP_EXCEEDED']);
export type ScanCompletedStatus = z.infer<typeof ScanCompletedStatusSchema>;

export const ScanCompletedEventSchema = z.object({
  scanLogId: z.string().min(1),
  organizationId: z.string().min(1),
  /** Jurisdiction code, e.g. `'AR'`. String for forward-compat (MVP-13). */
  jurisdiction: z.string().min(1),
  status: ScanCompletedStatusSchema,
  alertsFound: z.number().int().nonnegative(),
  tokensUsed: z.number().int().nonnegative(),
  /** `Prisma.Decimal` serialized as string — no float drift on the wire. */
  costUsd: z.string(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  errorMsg: z.string().nullable(),
});
export type ScanCompletedEvent = z.infer<typeof ScanCompletedEventSchema>;

// ─── Settings: settings.updated ─────────────────────────────────────────────

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

// ─── Enrichment: enrichment.completed ────────────────────────────────────────

/**
 * Canonical event name emitted POST-enrichment by `EnrichmentListener`.
 *
 * Spec: `sdd/classifier-and-writer/spec` R-9-Enrichment-Completed-Event.
 * Design: `sdd/classifier-and-writer/design` ADR-8 (payload shape).
 *
 * Emitted exactly once per `scan.completed` consumed. Payload carries outcome
 * counts so consumers can act without re-querying `Alert` rows.
 */
export const ENRICHMENT_COMPLETED_EVENT = 'enrichment.completed' as const;

export const EnrichmentCompletedEventSchema = z.object({
  scanLogId: z.string().min(1),
  organizationId: z.string().min(1),
  /** Jurisdiction code, e.g. `'AR'`. Forwarded from the triggering ScanCompletedEvent. */
  jurisdiction: z.string().min(1),
  /** Alert IDs processed in this batch (all, regardless of outcome). */
  alertIds: z.array(z.string()),
  /** Per-outcome counts for the batch. */
  counts: z.object({
    completed: z.number().int().nonnegative(),
    classifyFailed: z.number().int().nonnegative(),
    writeFailed: z.number().int().nonnegative(),
    skippedCap: z.number().int().nonnegative(),
    skippedIrrelevant: z.number().int().nonnegative(),
  }),
  /** Combined enrichment cost for the batch (Prisma.Decimal serialized as string). */
  totalCostUsd: z.string(),
  completedAt: z.iso.datetime(),
});

export type EnrichmentCompletedEvent = z.infer<typeof EnrichmentCompletedEventSchema>;

// ─── Alert collaboration events (MVP-8) ─────────────────────────────────────

/**
 * Emitted POST-commit by `AlertsService.transition()` when an Alert changes status.
 *
 * Spec: `sdd/alert-collaboration/spec` — R "Domain Events Pre-Wired".
 * Listener wiring: MVP-9 (`notify-slack`). Until then emitted with no consumer.
 */
export const ALERT_STATUS_CHANGED_EVENT = 'alert.status.changed' as const;

export const AlertStatusChangedEventSchema = z.object({
  alertId: z.string().min(1),
  organizationId: z.string().min(1),
  actorId: z.string().min(1),
  fromStatus: z.enum(ALERT_STATUS_VALUES).nullable(),
  toStatus: z.enum(ALERT_STATUS_VALUES),
  note: z.string().nullable(),
  changedAt: z.iso.datetime(),
});
export type AlertStatusChangedEvent = z.infer<typeof AlertStatusChangedEventSchema>;

/**
 * Emitted POST-commit by `AlertsService.assign()`.
 */
export const ALERT_ASSIGNED_EVENT = 'alert.assigned' as const;

export const AlertAssignedEventSchema = z.object({
  alertId: z.string().min(1),
  organizationId: z.string().min(1),
  actorId: z.string().min(1),
  assigneeId: z.string().nullable(),
  assignedAt: z.iso.datetime(),
});
export type AlertAssignedEvent = z.infer<typeof AlertAssignedEventSchema>;

/**
 * Emitted POST-commit by `AlertsService.conclude()`.
 *
 * Spec scenario: "alert.conclusion.updated emitted — carries { alertId, organizationId, actorId, conclusion }".
 * Note: conclude() only updates conclusion text, not the alert status.
 */
export const ALERT_CONCLUSION_UPDATED_EVENT = 'alert.conclusion.updated' as const;

export const AlertConclusionUpdatedEventSchema = z.object({
  alertId: z.string().min(1),
  organizationId: z.string().min(1),
  actorId: z.string().min(1),
  conclusion: z.string().min(1),
  updatedAt: z.iso.datetime(),
});
export type AlertConclusionUpdatedEvent = z.infer<typeof AlertConclusionUpdatedEventSchema>;
