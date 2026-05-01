import 'reflect-metadata';
import { Prisma } from '@regwatch/db/client';
import type { MonthlyUsage } from '@regwatch/db/usage';
import { describe, expect, it, vi } from 'vitest';
import type { UsageRepo } from '../usage.repo.js';
import { UsageService } from '../usage.service.js';

/**
 * Unit suite for `UsageService` (B6).
 *
 * Spec: `sdd/scanner-vertical-ar/spec` R-11-CanScanThisMonth,
 *   R-12-UsageReadEndpoint, INV-UT-1 (single source of truth via the
 *   `getMonthlyUsage` helper), INV-UT-2 (no caching MVP-5).
 * Design: `sdd/scanner-vertical-ar/design` ADR-11.
 *
 * Scope: pure service-layer behavior — repo is mocked via `vi.fn()`.
 * Decimal coercion + percent clamping are owned by the DTO mapper at the
 * controller boundary (covered by `usage.controller.spec.ts`); this suite
 * pins the "thin pass-through" contract: orgId is forwarded verbatim, the
 * helper-shape Decimals travel through unchanged, and no caching layer
 * silently swallows repeated calls.
 */

function makeRepo(overrides: Partial<UsageRepo> = {}): UsageRepo {
  return {
    getMonthly: vi.fn(),
    ...overrides,
  };
}

function makeUsage(overrides: Partial<MonthlyUsage> = {}): MonthlyUsage {
  return {
    tokensUsed: 1234,
    costUsd: new Prisma.Decimal('0.123456'),
    scansCount: 3,
    capUsd: new Prisma.Decimal('10'),
    isAtCap: false,
    percent: 1,
    monthStart: new Date('2026-04-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('UsageService', () => {
  describe('getCurrent', () => {
    it('forwards organizationId to the repo and returns the helper-shape unchanged', async () => {
      // INV-UT-1: the service is a thin seam over `getMonthlyUsage` — the
      // shape returned to the controller MUST be the SAME reference so the
      // DTO mapper sees the helper's Decimal-typed costUsd / capUsd. Any
      // accidental destructuring here would silently coerce Decimals.
      const usage = makeUsage();
      const repo = makeRepo({ getMonthly: vi.fn().mockResolvedValue(usage) });
      const svc = new UsageService(repo);

      const result = await svc.getCurrent('org_target');

      expect(repo.getMonthly).toHaveBeenCalledWith('org_target');
      expect(result).toBe(usage);
      expect(result.costUsd).toBeInstanceOf(Prisma.Decimal);
      expect(result.capUsd).toBeInstanceOf(Prisma.Decimal);
    });

    it('does NOT cache — every call hits the repo (INV-UT-2)', async () => {
      // INV-UT-2: MVP-5 ships with NO in-memory cache; the widget polls
      // and MUST always reflect the persisted state. Pin the no-cache
      // contract here so a future "let's memoize" PR breaks loudly.
      const repo = makeRepo({
        getMonthly: vi.fn().mockResolvedValue(makeUsage()),
      });
      const svc = new UsageService(repo);

      await svc.getCurrent('org_a');
      await svc.getCurrent('org_a');
      await svc.getCurrent('org_b');

      expect(repo.getMonthly).toHaveBeenCalledTimes(3);
      expect(repo.getMonthly).toHaveBeenNthCalledWith(1, 'org_a');
      expect(repo.getMonthly).toHaveBeenNthCalledWith(2, 'org_a');
      expect(repo.getMonthly).toHaveBeenNthCalledWith(3, 'org_b');
    });

    it('propagates repo failures (no swallowing — caller decides)', async () => {
      // The controller's exception filter / Nest's default 500 path is the
      // single place that converts thrown errors to HTTP. The service MUST
      // not catch — pin it here so a "let's add a fallback" change breaks.
      const boom = new Error('db unreachable');
      const repo = makeRepo({ getMonthly: vi.fn().mockRejectedValue(boom) });
      const svc = new UsageService(repo);

      await expect(svc.getCurrent('org_target')).rejects.toBe(boom);
    });
  });
});
