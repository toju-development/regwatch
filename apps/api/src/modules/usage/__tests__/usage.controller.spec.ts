import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Prisma } from '@regwatch/db/client';
import type { MonthlyUsage } from '@regwatch/db/usage';
import type { Role } from '@regwatch/types';
import { describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../../../common/auth/decorators/roles.decorator.js';
import { UsageController } from '../usage.controller.js';
import { UsageService } from '../usage.service.js';

/**
 * Light unit suite for `UsageController` (B6).
 *
 * Spec: `sdd/scanner-vertical-ar/spec` R-12-UsageReadEndpoint.
 * Design: `sdd/scanner-vertical-ar/design` ADR-11.
 *
 * Scope: this suite is INTENTIONALLY NOT a full integration test —
 * `usage.integration.spec.ts` covers controller + service + repo + DB +
 * the full 4-guard chain end-to-end. The controller layer adds three
 * things on top of the service that are worth pinning down here without
 * spinning up Postgres + a Nest HTTP listener:
 *
 *   1. Decorator metadata (path, verb, NO `@Roles` on GET) — guard
 *      contracts. If a future refactor adds `@Roles('OWNER','ADMIN')`
 *      on this GET handler, the wire authorization silently tightens
 *      and the VIEWER widget breaks (R-12 "any role with org membership
 *      may read").
 *   2. DTO coercion at the wire boundary (Decimal → string,
 *      percent clamp [0..100], monthStart ISO).
 *   3. Defense-in-depth `assertOrgScope` — 403 when `:orgId` segment
 *      mismatches the `OrgScopeGuard`-resolved org.
 *   4. Nest DI smoke — `@Inject(UsageService)` per foot-gun #667.
 *
 * The service is mocked via a `vi.fn()` stub — every test exercises ONLY
 * the controller method, never the real domain logic.
 */

const FIXED_MONTH_START = new Date('2026-04-01T00:00:00.000Z');

function makeUsage(overrides: Partial<MonthlyUsage> = {}): MonthlyUsage {
  return {
    tokensUsed: 12_345,
    costUsd: new Prisma.Decimal('1.234567'),
    scanCostUsd: new Prisma.Decimal('1.234567'),
    enrichmentCostUsd: new Prisma.Decimal('0'),
    scansCount: 3,
    capUsd: new Prisma.Decimal('10'),
    isAtCap: false,
    percent: 12,
    monthStart: FIXED_MONTH_START,
    lastSkippedCapAt: null,
    ...overrides,
  };
}

function buildController(serviceOverrides: Partial<UsageService> = {}): {
  controller: UsageController;
  service: UsageService;
} {
  const service = {
    getCurrent: vi.fn(),
    ...serviceOverrides,
  } as unknown as UsageService;
  const controller = new UsageController(service);
  return { controller, service };
}

describe('UsageController', () => {
  describe('decorator metadata (guard contracts)', () => {
    it('exposes get at the spec-mandated path + verb (org/:orgId/usage/current, GET)', () => {
      // R-12 + ADR-11 pin the path; the class `@Controller()` carries no
      // prefix, so the method-level `@Get(...)` IS the absolute path. If
      // someone refactors to a controller-level prefix (e.g.
      // `@Controller('org/:orgId/usage')`), this test breaks loudly.
      // NestJS `RequestMethod` enum: GET=0.
      const fn = (UsageController.prototype as unknown as Record<string, unknown>)['get'] as
        | ((...args: unknown[]) => unknown)
        | undefined;
      if (!fn) throw new Error('Handler `get` is missing on UsageController.');
      const path = Reflect.getMetadata(PATH_METADATA, fn) as string;
      const method = Reflect.getMetadata(METHOD_METADATA, fn) as number;
      expect(path).toBe('org/:orgId/usage/current');
      expect(method).toBe(0);
    });

    it('GET has NO @Roles — any member of orgId may read (R-12, ADR-11)', () => {
      // R-12 spec scenario: "VIEWER can read own-org usage". Adding
      // `@Roles(...)` here would tighten authorization and break the
      // widget for VIEWER / ANALYST. Pin the absence explicitly.
      const reflector = new Reflector();
      const getRoles = reflector.get<Role[] | undefined>(ROLES_KEY, UsageController.prototype.get);
      expect(getRoles).toBeUndefined();
    });
  });

  describe('handler behavior', () => {
    it('GET — calls service.getCurrent with orgId and returns the wrapped DTO', async () => {
      // Plumbing test — orgId reaches the service verbatim, response is
      // wrapped under `currentMonth` + `isAtCap` per ADR-11 envelope.
      const { controller, service } = buildController({
        getCurrent: vi.fn().mockResolvedValue(makeUsage()),
      });

      const result = await controller.get('org_target', 'org_target');

      expect(service.getCurrent).toHaveBeenCalledWith('org_target');
      expect(result).toEqual({
        currentMonth: {
          tokensUsed: 12_345,
          costUsd: '1.234567',
          scansCount: 3,
          capUsd: '10',
          percent: 12,
          monthStart: FIXED_MONTH_START.toISOString(),
          lastSkippedCapAt: null,
        },
        isAtCap: false,
      });
    });

    it('GET — serializes Decimals as strings (R-12 Decimal-as-string scenario)', async () => {
      // INV-SP-3: `Prisma.Decimal` end-to-end internally; the WIRE
      // boundary coerces via `.toString()` (NEVER `Number()`). Float
      // drift on sub-cent costs would corrupt the widget at $0.123456
      // precision.
      const { controller } = buildController({
        getCurrent: vi.fn().mockResolvedValue(
          makeUsage({
            costUsd: new Prisma.Decimal('0.000001'),
            capUsd: new Prisma.Decimal('10'),
          }),
        ),
      });

      const result = await controller.get('org_target', 'org_target');

      expect(typeof result.currentMonth.costUsd).toBe('string');
      expect(typeof result.currentMonth.capUsd).toBe('string');
      expect(result.currentMonth.costUsd).toBe('0.000001');
      expect(result.currentMonth.capUsd).toBe('10');
    });

    it('GET — clamps percent to 100 when helper reports overrun (ADR-6 mid-scan over-shoot)', async () => {
      // ADR-6: a scan started just under cap MAY commit slightly over,
      // producing a `percent` > 100 from the helper. The widget renders
      // a progress bar; values >100 would overflow visually. Clamp at
      // the DTO boundary so the helper stays faithful for cost-monitoring
      // callers but UI sees a safe ceiling.
      const { controller } = buildController({
        getCurrent: vi.fn().mockResolvedValue(
          makeUsage({
            costUsd: new Prisma.Decimal('10.5'),
            isAtCap: true,
            percent: 105,
          }),
        ),
      });

      const result = await controller.get('org_target', 'org_target');
      expect(result.currentMonth.percent).toBe(100);
      expect(result.isAtCap).toBe(true);
    });

    it('GET — surfaces isAtCap=true at envelope top level (ADR-11 short-circuit slot)', async () => {
      // ADR-11: `isAtCap` is hoisted out of `currentMonth` so the widget
      // can short-circuit the cap-reached UI without parsing numbers.
      const { controller } = buildController({
        getCurrent: vi.fn().mockResolvedValue(
          makeUsage({
            costUsd: new Prisma.Decimal('10'),
            isAtCap: true,
            percent: 100,
          }),
        ),
      });

      const result = await controller.get('org_target', 'org_target');
      expect(result.isAtCap).toBe(true);
    });

    it('GET — throws 403 when :orgId mismatches resolved org (assertOrgScope)', async () => {
      // Defense-in-depth — `OrgScopeGuard` already gates on `X-Org-Id`,
      // but a pathological client could send `:orgId` ≠ `X-Org-Id`. The
      // assertion converts that to 403 instead of letting the call
      // silently target the header-resolved org. Service MUST NOT be
      // called when the assertion fires.
      const { controller, service } = buildController();
      await expect(controller.get('org_alpha', 'org_beta')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(service.getCurrent).not.toHaveBeenCalled();
    });

    it('GET — zero-usage org returns percent=0 + isAtCap=false (cold-start path)', async () => {
      // Empty `ScanLog` aggregate → helper returns Decimal(0) for cost,
      // 0 for tokens / count, percent=0, isAtCap=false. The DTO must
      // pass these through cleanly (string "0", not "0.000000" nor "").
      const { controller } = buildController({
        getCurrent: vi.fn().mockResolvedValue(
          makeUsage({
            tokensUsed: 0,
            costUsd: new Prisma.Decimal(0),
            scansCount: 0,
            isAtCap: false,
            percent: 0,
          }),
        ),
      });

      const result = await controller.get('org_target', 'org_target');
      expect(result.currentMonth.tokensUsed).toBe(0);
      expect(result.currentMonth.scansCount).toBe(0);
      expect(result.currentMonth.percent).toBe(0);
      expect(result.currentMonth.costUsd).toBe('0');
      expect(result.isAtCap).toBe(false);
    });
  });

  /**
   * Smoke-level Nest DI check: the controller resolves with an injected
   * service via the `UsageService` token. This catches the foot-gun #667
   * regression where someone removes the explicit `@Inject(UsageService)`
   * and relies on (broken-under-tsx) `design:paramtypes` metadata.
   */
  it('resolves through Nest DI with UsageService injected', async () => {
    const stubService = {
      getCurrent: vi.fn(),
    } as unknown as UsageService;
    const moduleRef = await Test.createTestingModule({
      controllers: [UsageController],
      providers: [{ provide: UsageService, useValue: stubService }],
    }).compile();
    const controller = moduleRef.get(UsageController);
    expect(controller).toBeInstanceOf(UsageController);
    await moduleRef.close();
  });
});
