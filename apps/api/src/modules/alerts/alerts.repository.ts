/**
 * AlertsRepo — thin Prisma wrapper for the alerts collaboration domain.
 *
 * sdd/alert-collaboration/design D6: single repo covers alerts + comments + events.
 * All methods are pure data access — zero business logic here.
 *
 * Foot-gun #667: explicit @Inject(ALERTS_PRISMA_TOKEN).
 */

import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@regwatch/db/client';
import type { AlertStatus, AlertEventKind, CursorPage } from '@regwatch/types';
import { ALERTS_PRISMA_TOKEN } from './tokens.js';
import type { AlertStatsDto } from './dto/alert-stats.dto.js';

// Shape returned by findById — include assignee and comment count
export interface AlertWithMeta {
  id: string;
  organizationId: string;
  status: AlertStatus;
  assigneeId: string | null;
  conclusion: string | null;
  regulator: string | null;
  title: string;
  summary: string | null;
  fullContent: string | null;
  publishedAt: Date | null;
  detectedAt: Date;
  source: string;
  sourceUrl: string;
  severity: string;
  enrichmentStatus: string;
  executiveSummary: string | null;
  whatChangesForYou: string | null;
  assignee: { id: string; name: string | null; email: string } | null;
  _count: { comments: number };
}

export interface CommentRow {
  id: string;
  alertId: string;
  organizationId: string;
  authorId: string;
  body: string;
  parentId: string | null;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventRow {
  id: string;
  alertId: string;
  organizationId: string;
  actorId: string;
  kind: AlertEventKind;
  fromStatus: AlertStatus | null;
  toStatus: AlertStatus | null;
  assigneeId: string | null;
  note: string | null;
  createdAt: Date;
}

export interface AlertListItem {
  id: string;
  organizationId: string;
  status: AlertStatus;
  assigneeId: string | null;
  title: string;
  severity: string;
  source: string;
  detectedAt: Date;
  enrichmentStatus: string;
  assignee: { id: string; name: string | null; email: string } | null;
}

export interface ListFilters {
  status?: AlertStatus[];
  assigneeId?: string;
  cursor?: string;
  limit: number;
}

// Use a narrower type to avoid issues with Prisma's transaction type
type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class AlertsRepo {
  constructor(@Inject(ALERTS_PRISMA_TOKEN) private readonly prisma: PrismaClient) {}

  async findById(alertId: string, orgId: string): Promise<AlertWithMeta | null> {
    return this.prisma.alert.findFirst({
      where: { id: alertId, organizationId: orgId },
      select: {
        id: true,
        organizationId: true,
        status: true,
        assigneeId: true,
        conclusion: true,
        regulator: true,
        title: true,
        summary: true,
        fullContent: true,
        publishedAt: true,
        detectedAt: true,
        source: true,
        sourceUrl: true,
        severity: true,
        enrichmentStatus: true,
        executiveSummary: true,
        whatChangesForYou: true,
        assignee: { select: { id: true, name: true, email: true } },
        _count: { select: { comments: true } },
      },
    }) as Promise<AlertWithMeta | null>;
  }

  async listByOrg(orgId: string, filters: ListFilters): Promise<CursorPage<AlertListItem>> {
    const { status, assigneeId, cursor, limit } = filters;
    const statusList = status?.length ? status : undefined;

    const items = (await this.prisma.alert.findMany({
      where: {
        organizationId: orgId,
        ...(statusList ? { status: { in: statusList } } : {}),
        ...(assigneeId ? { assigneeId } : {}),
      },
      orderBy: { id: 'desc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: limit + 1,
      select: {
        id: true,
        organizationId: true,
        status: true,
        assigneeId: true,
        title: true,
        severity: true,
        source: true,
        detectedAt: true,
        enrichmentStatus: true,
        assignee: { select: { id: true, name: true, email: true } },
      },
    })) as AlertListItem[];

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    return { items: page, nextCursor };
  }

  async findComments(
    alertId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<CursorPage<CommentRow>> {
    const items = (await this.prisma.alertComment.findMany({
      where: { alertId },
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: limit + 1,
    })) as CommentRow[];

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    return { items: page, nextCursor };
  }

  async findEvents(alertId: string): Promise<EventRow[]> {
    return this.prisma.alertEvent.findMany({
      where: { alertId },
      orderBy: { createdAt: 'asc' },
    }) as Promise<EventRow[]>;
  }

  async updateAlert(
    tx: PrismaTx,
    alertId: string,
    patch: Partial<{ status: AlertStatus; assigneeId: string | null; conclusion: string }>,
  ) {
    return tx.alert.update({ where: { id: alertId }, data: patch });
  }

  async createComment(
    tx: PrismaTx,
    data: {
      alertId: string;
      organizationId: string;
      authorId: string;
      body: string;
      parentId?: string | null;
    },
  ): Promise<CommentRow> {
    return tx.alertComment.create({ data }) as Promise<CommentRow>;
  }

  async createEvent(
    tx: PrismaTx,
    data: {
      alertId: string;
      organizationId: string;
      actorId: string;
      kind: AlertEventKind;
      fromStatus?: AlertStatus | null;
      toStatus?: AlertStatus | null;
      assigneeId?: string | null;
      note?: string | null;
    },
  ): Promise<EventRow> {
    return tx.alertEvent.create({ data }) as Promise<EventRow>;
  }

  async findParentComment(commentId: string): Promise<CommentRow | null> {
    return this.prisma.alertComment.findUnique({
      where: { id: commentId },
    }) as Promise<CommentRow | null>;
  }

  async findComment(commentId: string): Promise<CommentRow | null> {
    return this.prisma.alertComment.findUnique({
      where: { id: commentId },
    }) as Promise<CommentRow | null>;
  }

  async deleteComment(commentId: string): Promise<void> {
    await this.prisma.alertComment.delete({ where: { id: commentId } });
  }

  /** Aggregate alert counts by status and severity for the org (MVP-10). */
  async statsForOrg(orgId: string): Promise<AlertStatsDto> {
    const [byStatusRaw, bySeverityRaw] = await Promise.all([
      this.prisma.alert.groupBy({
        by: ['status'],
        where: { organizationId: orgId },
        _count: { _all: true },
      }),
      this.prisma.alert.groupBy({
        by: ['severity'],
        where: { organizationId: orgId },
        _count: { _all: true },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of byStatusRaw) {
      byStatus[row.status as string] = row._count._all;
    }

    const bySeverity: Record<string, number> = {};
    for (const row of bySeverityRaw) {
      bySeverity[row.severity as string] = row._count._all;
    }

    const total = byStatusRaw.reduce((sum, r) => sum + r._count._all, 0);

    return { byStatus, bySeverity, total };
  }

  /** Verify that userId has an active Membership in orgId (INV-COLLAB-1). */
  async isMember(userId: string, orgId: string): Promise<boolean> {
    const m = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      select: { id: true },
    });
    return m !== null;
  }

  $transaction<T>(fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      fn as Parameters<PrismaClient['$transaction']>[0],
    ) as Promise<T>;
  }
}
