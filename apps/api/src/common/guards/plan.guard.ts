/**
 * PlanGuard — enforces Free-plan limits on ingest and alert-creation
 * endpoints. Applied at the route level via `@UseGuards(PlanGuard)`.
 *
 * sdd/billing-stripe POST-9 — Task 3.1.
 *
 * Logic:
 *   1. Read orgId from `request.membership` (set by OrgScopeGuard).
 *   2. Fetch Subscription row for the org (null = Free plan).
 *   3. If status is 'active' or 'trialing' → Pro → pass.
 *   4. Free path: count current-month alerts.
 *      If count ≥ FREE_PLAN_LIMITS.alertsPerMonth → 403 PLAN_LIMIT_EXCEEDED.
 *   5. Otherwise → pass.
 *
 * Design: `sdd/billing-stripe/design` §PlanGuard logic.
 * Spec: `sdd/billing-stripe/spec` § 4. PlanGuard.
 *
 * Foot-gun #667: explicit @Inject(PRISMA_CLIENT).
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PrismaClient } from '@regwatch/db';
import { PRISMA_CLIENT } from '../prisma/prisma.token.js';
import { FREE_PLAN_LIMITS } from '@regwatch/types';

@Injectable()
export class PlanGuard implements CanActivate {
  private readonly logger = new Logger(PlanGuard.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { membership?: { organizationId: string; role: string } }>();

    const orgId = request.membership?.organizationId;
    if (!orgId) {
      // Defensive: OrgScopeGuard must run before PlanGuard.
      // If membership is missing, let the request through — OrgScopeGuard
      // or JwtAuthGuard would already have rejected it.
      return true;
    }

    // Check subscription status
    const sub = await this.prisma.subscription.findUnique({
      where: { organizationId: orgId },
      select: { status: true },
    });

    if (sub?.status === 'active' || sub?.status === 'trialing') {
      // Pro plan — no restrictions
      return true;
    }

    // Free plan: count alerts created this calendar month (UTC)
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const alertCount = await this.prisma.alert.count({
      where: {
        organizationId: orgId,
        createdAt: { gte: startOfMonth },
      },
    });

    if (alertCount >= FREE_PLAN_LIMITS.alertsPerMonth) {
      this.logger.log(
        `PlanGuard: org ${orgId} blocked — Free plan alert limit reached (${alertCount}/${FREE_PLAN_LIMITS.alertsPerMonth})`,
      );
      throw new ForbiddenException('PLAN_LIMIT_EXCEEDED');
    }

    return true;
  }
}
