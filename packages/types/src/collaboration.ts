/**
 * Shared types for the alert collaboration domain (MVP-8).
 *
 * sdd/alert-collaboration/spec — api-alerts domain.
 * sdd/alert-collaboration/design — D1 (state machine as lookup table), D5 (role split).
 *
 * This file is the single source of truth for:
 *   - AlertStatus / AlertEventKind value sets
 *   - Allowed state-machine transitions
 *   - Role guards per transition
 *   - Cursor pagination envelope
 *   - DTO shapes shared between api and web
 */

// ─── Status + event-kind value sets ─────────────────────────────────────────

export const ALERT_STATUS_VALUES = [
  'NEW',
  'TRIAGING',
  'ANALYZING',
  'DEBATING',
  'CONCLUDED',
  'DISTRIBUTED',
  'ARCHIVED',
] as const;

export type AlertStatus = (typeof ALERT_STATUS_VALUES)[number];

export const ALERT_EVENT_KIND_VALUES = [
  'STATUS_CHANGED',
  'ASSIGNED',
  'CONCLUSION_UPDATED',
  'COMMENT_ADDED',
] as const;

export type AlertEventKind = (typeof ALERT_EVENT_KIND_VALUES)[number];

// ─── State machine ───────────────────────────────────────────────────────────

/**
 * Valid `to` states reachable from each `from` state.
 *
 * Design D1: pure lookup table — no external state-machine library.
 *
 * Spec transition table:
 *   NEW → TRIAGING (OWNER|ADMIN|ANALYST)
 *   TRIAGING → ANALYZING (OWNER|ADMIN|assignee)
 *   ANALYZING → DEBATING (OWNER|ADMIN|assignee, ≥1 comment required by UI gate)
 *   ANALYZING → CONCLUDED (OWNER|ADMIN, conclusion required)
 *   DEBATING → ANALYZING (OWNER|ADMIN|assignee)
 *   DEBATING → CONCLUDED (OWNER|ADMIN, conclusion required)
 *   ANY → ARCHIVED (OWNER|ADMIN)
 *   ARCHIVED → NEW (OWNER|ADMIN)
 *   CONCLUDED → DISTRIBUTED (system-only — BLOCKED for human actors)
 */
export const ALERT_TRANSITIONS: Record<AlertStatus, AlertStatus[]> = {
  NEW: ['TRIAGING', 'ARCHIVED'],
  TRIAGING: ['ANALYZING', 'ARCHIVED'],
  ANALYZING: ['DEBATING', 'CONCLUDED', 'ARCHIVED'],
  DEBATING: ['CONCLUDED', 'ANALYZING', 'ARCHIVED'],
  CONCLUDED: ['DISTRIBUTED', 'ARCHIVED'],
  DISTRIBUTED: [],
  ARCHIVED: ['NEW'],
};

/**
 * Roles allowed to drive each specific transition.
 * Empty array = any non-VIEWER role (OWNER|ADMIN|ANALYST all allowed).
 *
 * Special flags handled in service code:
 *   - `assigneeAllowed`: TRIAGING→ANALYZING and ANALYZING→DEBATING also allow the assignee
 *   - `requiresConclusion`: ANALYZING→CONCLUDED and DEBATING→CONCLUDED require non-null conclusion
 *   - CONCLUDED→DISTRIBUTED is ALWAYS blocked for human actors (system-only)
 */
export interface TransitionRule {
  /** Roles explicitly allowed. Empty = all non-VIEWER roles. */
  roles: Array<'OWNER' | 'ADMIN' | 'ANALYST'>;
  /** If true, the current assignee is also allowed regardless of role. */
  assigneeAllowed?: boolean;
  /** If true, Alert.conclusion must be non-null before the transition is allowed. */
  requiresConclusion?: boolean;
  /** If true, the transition is rejected for ALL human actors (system-only). */
  systemOnly?: boolean;
}

export const TRANSITION_RULES: Partial<Record<`${AlertStatus}->${AlertStatus}`, TransitionRule>> = {
  'NEW->TRIAGING': { roles: ['OWNER', 'ADMIN', 'ANALYST'] },
  'TRIAGING->ANALYZING': { roles: ['OWNER', 'ADMIN'], assigneeAllowed: true },
  'ANALYZING->DEBATING': { roles: ['OWNER', 'ADMIN'], assigneeAllowed: true },
  'ANALYZING->CONCLUDED': { roles: ['OWNER', 'ADMIN'], requiresConclusion: true },
  'DEBATING->CONCLUDED': { roles: ['OWNER', 'ADMIN'], requiresConclusion: true },
  'CONCLUDED->DISTRIBUTED': { roles: [], systemOnly: true },
  // ANY->ARCHIVED and ARCHIVED->NEW: OWNER|ADMIN only (default roles guard covers this)
  'NEW->ARCHIVED': { roles: ['OWNER', 'ADMIN'] },
  'TRIAGING->ARCHIVED': { roles: ['OWNER', 'ADMIN'] },
  'ANALYZING->ARCHIVED': { roles: ['OWNER', 'ADMIN'] },
  'DEBATING->ARCHIVED': { roles: ['OWNER', 'ADMIN'] },
  'CONCLUDED->ARCHIVED': { roles: ['OWNER', 'ADMIN'] },
  'ARCHIVED->NEW': { roles: ['OWNER', 'ADMIN'] },
};

// ─── Cursor pagination envelope ──────────────────────────────────────────────

/**
 * Generic cursor-paginated response envelope.
 * Design D4: cursor = last item `id`; queries order by `id` to guarantee
 * stable pagination (CUID2 ids sort by insertion order).
 */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

// ─── DTO shapes ──────────────────────────────────────────────────────────────

export interface AlertCommentDto {
  id: string;
  alertId: string;
  organizationId: string;
  authorId: string;
  body: string;
  parentId: string | null;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertEventDto {
  id: string;
  alertId: string;
  organizationId: string;
  actorId: string;
  kind: AlertEventKind;
  fromStatus: AlertStatus | null;
  toStatus: AlertStatus | null;
  assigneeId: string | null;
  note: string | null;
  createdAt: string;
}

export interface AlertCollaborationDto {
  status: AlertStatus;
  assigneeId: string | null;
  conclusion: string | null;
  regulator: string | null;
  commentCount: number;
}
