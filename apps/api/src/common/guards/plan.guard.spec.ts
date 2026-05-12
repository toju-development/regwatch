/**
 * Unit tests for `PlanGuard`.
 *
 * sdd/billing-stripe POST-9 — Task 5.3.
 *
 * Tests:
 *   - Free org with count < 10 → passes (returns true)
 *   - Free org with count ≥ 10 → throws ForbiddenException(PLAN_LIMIT_EXCEEDED)
 *   - Pro org (status=active) → passes regardless of alert count
 *   - Pro org (status=trialing) → passes
 *   - Past-due org (not active/trialing) → treated as Free → count-checked
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { PlanGuard } from './plan.guard.js';

// ─── Prisma mock ───────────────────────────────────────────────────────────

const mockFindUnique = vi.fn();
const mockAlertCount = vi.fn();

const mockPrisma = {
  subscription: { findUnique: mockFindUnique },
  alert: { count: mockAlertCount },
};

// ─── Helper ────────────────────────────────────────────────────────────────

function makeContext(orgId: string | undefined): ExecutionContext {
  const membership = orgId ? { organizationId: orgId, role: 'OWNER' } : undefined;
  return {
    switchToHttp: () => ({
      getRequest: () => ({ membership }),
    }),
  } as unknown as ExecutionContext;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('PlanGuard', () => {
  let guard: PlanGuard;

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    guard = new PlanGuard(mockPrisma as any);
  });

  it('Free org with count < 10 → passes', async () => {
    mockFindUnique.mockResolvedValueOnce(null); // no subscription = Free
    mockAlertCount.mockResolvedValueOnce(5);

    const result = await guard.canActivate(makeContext('org_free_123'));

    expect(result).toBe(true);
  });

  it('Free org with count === 10 → throws PLAN_LIMIT_EXCEEDED', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    mockAlertCount.mockResolvedValueOnce(10);

    await expect(guard.canActivate(makeContext('org_free_123'))).rejects.toThrow(
      new ForbiddenException('PLAN_LIMIT_EXCEEDED'),
    );
  });

  it('Free org with count > 10 → throws PLAN_LIMIT_EXCEEDED', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    mockAlertCount.mockResolvedValueOnce(15);

    await expect(guard.canActivate(makeContext('org_free_123'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('Pro org (status=active) → passes without counting alerts', async () => {
    mockFindUnique.mockResolvedValueOnce({ status: 'active' });

    const result = await guard.canActivate(makeContext('org_pro_123'));

    expect(result).toBe(true);
    expect(mockAlertCount).not.toHaveBeenCalled();
  });

  it('Pro org (status=trialing) → passes', async () => {
    mockFindUnique.mockResolvedValueOnce({ status: 'trialing' });

    const result = await guard.canActivate(makeContext('org_trial_123'));

    expect(result).toBe(true);
    expect(mockAlertCount).not.toHaveBeenCalled();
  });

  it('past_due org → treated as Free → count-checked', async () => {
    mockFindUnique.mockResolvedValueOnce({ status: 'past_due' });
    mockAlertCount.mockResolvedValueOnce(11);

    await expect(guard.canActivate(makeContext('org_pastdue_123'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('no membership on request → passes through (guard deferred)', async () => {
    // If OrgScopeGuard hasn't run (route is @Public or misconfigured),
    // PlanGuard should not throw — other guards handle the auth failure.
    const result = await guard.canActivate(makeContext(undefined));

    expect(result).toBe(true);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});
