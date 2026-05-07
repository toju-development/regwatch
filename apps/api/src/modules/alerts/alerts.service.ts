/**
 * AlertsService — core business logic for the alert collaboration domain.
 *
 * sdd/alert-collaboration/spec R "Status Transition Guard", R "Assignment
 * Invariant INV-COLLAB-1", R "Comment CRUD Authorization", R "Domain Events
 * Pre-Wired".
 *
 * Design D1: state machine as pure lookup table (TRANSITION_RULES).
 * Design D2: EventEmitter2 emit POST-commit in try/catch — NEVER rethrows.
 * Design D5: role enforcement split — guard (coarse) + service (fine-grained).
 *
 * Foot-gun #667: explicit @Inject tokens everywhere.
 */

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AlertStatus, AlertEventKind, CursorPage } from '@regwatch/types';
import {
  ALERT_TRANSITIONS,
  TRANSITION_RULES,
  ALERT_STATUS_CHANGED_EVENT,
  ALERT_ASSIGNED_EVENT,
  ALERT_CONCLUDED_EVENT,
} from '@regwatch/types';
import type {
  AlertsRepo,
  AlertWithMeta,
  CommentRow,
  EventRow,
  AlertListItem,
  ListFilters,
} from './alerts.repository.js';
import type { ListAlertsDto } from './dto/list-alerts.dto.js';

// Actor shape from JWT / OrgScopeGuard
export interface Actor {
  id: string;
  role: 'OWNER' | 'ADMIN' | 'ANALYST' | 'VIEWER';
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @Inject('ALERTS_REPO') private readonly repo: AlertsRepo,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  // ─── List / Get ───────────────────────────────────────────────────────────

  async listAlerts(orgId: string, filters: ListAlertsDto): Promise<CursorPage<AlertListItem>> {
    const statusFilter = filters.status as AlertStatus | AlertStatus[] | undefined;
    const repoFilters: ListFilters = { limit: filters.limit ?? 20 };
    if (statusFilter !== undefined) repoFilters.status = statusFilter;
    if (filters.assigneeId !== undefined) repoFilters.assigneeId = filters.assigneeId;
    if (filters.cursor !== undefined) repoFilters.cursor = filters.cursor;
    return this.repo.listByOrg(orgId, repoFilters);
  }

  async getAlert(orgId: string, alertId: string): Promise<AlertWithMeta> {
    const alert = await this.repo.findById(alertId, orgId);
    if (!alert) throw new NotFoundException('Alert not found');
    return alert;
  }

  // ─── Transition ───────────────────────────────────────────────────────────

  async transition(
    orgId: string,
    alertId: string,
    toStatus: AlertStatus,
    actor: Actor,
    note?: string,
  ): Promise<AlertWithMeta> {
    const alert = await this.repo.findById(alertId, orgId);
    if (!alert) throw new NotFoundException('Alert not found');

    const fromStatus = alert.status;

    // 1. Is the transition in the reachable set?
    const reachable = ALERT_TRANSITIONS[fromStatus];
    if (!reachable.includes(toStatus)) {
      throw new UnprocessableEntityException(
        `Transition ${fromStatus} → ${toStatus} is not allowed`,
      );
    }

    // 2. Rule-based guards
    const ruleKey = `${fromStatus}->${toStatus}` as `${AlertStatus}->${AlertStatus}`;
    const rule = TRANSITION_RULES[ruleKey];

    if (rule?.systemOnly) {
      throw new ForbiddenException(
        'This transition is system-only and cannot be performed by a human actor',
      );
    }

    if (rule) {
      const isAssignee = alert.assigneeId === actor.id;
      const isAllowedRole =
        rule.roles.length === 0
          ? actor.role !== 'VIEWER'
          : (rule.roles as string[]).includes(actor.role);
      const isAllowedByAssignee = rule.assigneeAllowed === true && isAssignee;

      if (!isAllowedRole && !isAllowedByAssignee) {
        throw new ForbiddenException(
          `Role ${actor.role} is not allowed to perform transition ${fromStatus} → ${toStatus}`,
        );
      }

      if (rule.requiresConclusion && !alert.conclusion) {
        throw new UnprocessableEntityException({
          error: 'CONCLUSION_REQUIRED',
          message: 'Alert must have a conclusion before transitioning to CONCLUDED',
        });
      }
    }

    // 3. Persist in a transaction
    await this.repo.$transaction(async (tx) => {
      await this.repo.updateAlert(tx, alertId, { status: toStatus });
      await this.repo.createEvent(tx, {
        alertId,
        organizationId: orgId,
        actorId: actor.id,
        kind: 'STATUS_CHANGED' as AlertEventKind,
        fromStatus,
        toStatus,
        note: note ?? null,
      });
    });

    // 4. Emit post-commit (try/catch — never rethrow)
    try {
      this.events.emit(ALERT_STATUS_CHANGED_EVENT, {
        alertId,
        organizationId: orgId,
        actorId: actor.id,
        fromStatus,
        toStatus,
        note: note ?? null,
        changedAt: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warn(
        `Failed to emit ${ALERT_STATUS_CHANGED_EVENT}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return (await this.repo.findById(alertId, orgId))!;
  }

  // ─── Assign ───────────────────────────────────────────────────────────────

  async assign(
    orgId: string,
    alertId: string,
    assigneeId: string | null,
    actor: Actor,
  ): Promise<AlertWithMeta> {
    const alert = await this.repo.findById(alertId, orgId);
    if (!alert) throw new NotFoundException('Alert not found');

    // INV-COLLAB-1: assignee must be an active member of the org
    if (assigneeId !== null) {
      const isMember = await this.repo.isMember(assigneeId, orgId);
      if (!isMember) {
        throw new UnprocessableEntityException({
          error: 'ASSIGNEE_NOT_MEMBER',
          message: 'Assignee is not an active member of this organization',
        });
      }
    }

    await this.repo.$transaction(async (tx) => {
      await this.repo.updateAlert(tx, alertId, { assigneeId });
      await this.repo.createEvent(tx, {
        alertId,
        organizationId: orgId,
        actorId: actor.id,
        kind: 'ASSIGNED' as AlertEventKind,
        assigneeId,
      });
    });

    try {
      this.events.emit(ALERT_ASSIGNED_EVENT, {
        alertId,
        organizationId: orgId,
        actorId: actor.id,
        assigneeId,
        assignedAt: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warn(
        `Failed to emit ${ALERT_ASSIGNED_EVENT}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return (await this.repo.findById(alertId, orgId))!;
  }

  // ─── Conclude ─────────────────────────────────────────────────────────────

  async conclude(
    orgId: string,
    alertId: string,
    conclusion: string,
    actor: Actor,
  ): Promise<AlertWithMeta> {
    if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Only OWNER or ADMIN can update the conclusion');
    }

    const alert = await this.repo.findById(alertId, orgId);
    if (!alert) throw new NotFoundException('Alert not found');

    await this.repo.$transaction(async (tx) => {
      await this.repo.updateAlert(tx, alertId, { conclusion });
      await this.repo.createEvent(tx, {
        alertId,
        organizationId: orgId,
        actorId: actor.id,
        kind: 'CONCLUSION_UPDATED' as AlertEventKind,
      });
    });

    try {
      this.events.emit(ALERT_CONCLUDED_EVENT, {
        alertId,
        organizationId: orgId,
        actorId: actor.id,
        conclusion,
        concludedAt: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warn(
        `Failed to emit ${ALERT_CONCLUDED_EVENT}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return (await this.repo.findById(alertId, orgId))!;
  }

  // ─── Comments ─────────────────────────────────────────────────────────────

  async listComments(
    orgId: string,
    alertId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<CommentRow>> {
    await this.requireAlert(alertId, orgId);
    return this.repo.findComments(alertId, cursor, limit);
  }

  async addComment(
    orgId: string,
    alertId: string,
    body: string,
    parentId: string | undefined,
    actor: Actor,
  ): Promise<CommentRow> {
    await this.requireAlert(alertId, orgId);

    if (parentId) {
      const parent = await this.repo.findParentComment(parentId);
      if (!parent || parent.alertId !== alertId) {
        throw new BadRequestException('Parent comment not found on this alert');
      }
      if (parent.parentId !== null) {
        throw new BadRequestException('Comment nesting depth > 1 is not allowed');
      }
    }

    let comment!: CommentRow;
    await this.repo.$transaction(async (tx) => {
      comment = await this.repo.createComment(tx, {
        alertId,
        organizationId: orgId,
        authorId: actor.id,
        body,
        parentId: parentId ?? null,
      });
      await this.repo.createEvent(tx, {
        alertId,
        organizationId: orgId,
        actorId: actor.id,
        kind: 'COMMENT_ADDED' as AlertEventKind,
      });
    });

    return comment;
  }

  async deleteComment(
    orgId: string,
    alertId: string,
    commentId: string,
    actor: Actor,
  ): Promise<void> {
    await this.requireAlert(alertId, orgId);

    const comment = await this.repo.findComment(commentId);
    if (!comment || comment.alertId !== alertId) {
      throw new NotFoundException('Comment not found');
    }

    const isAuthor = comment.authorId === actor.id;
    const isPrivileged = actor.role === 'OWNER' || actor.role === 'ADMIN';

    if (!isAuthor && !isPrivileged) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    await this.repo.deleteComment(commentId);
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  async listEvents(orgId: string, alertId: string): Promise<EventRow[]> {
    await this.requireAlert(alertId, orgId);
    return this.repo.findEvents(alertId);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async requireAlert(alertId: string, orgId: string): Promise<AlertWithMeta> {
    const alert = await this.repo.findById(alertId, orgId);
    if (!alert) throw new NotFoundException('Alert not found');
    return alert;
  }
}
