import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { AuthUser, Role, UpdateSettingsInput } from '@regwatch/types';
import { describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../../../common/auth/decorators/roles.decorator.js';
import { SettingsController } from '../settings.controller.js';
import { SettingsService } from '../settings.service.js';

/**
 * Light unit suite for `SettingsController`.
 *
 * Spec: `sdd/jurisdictions-config/spec` R-Settings-Get-Or-Create,
 *   R-Settings-Update.
 *
 * Scope: this suite is INTENTIONALLY NOT a full integration test —
 * `settings.integration.spec.ts` covers the controller + service + DB
 * + EventEmitter2 contract end-to-end. The controller adds three things
 * on top of the service that are worth pinning down here without
 * spinning up a Postgres + Nest HTTP listener:
 *
 *   1. Decorator metadata (`@Roles`, paths, HTTP verbs) — guard
 *      contracts. If a handler loses its `@Roles('OWNER','ADMIN')` the
 *      wire authorization silently degrades to "any member of the org"
 *      and no integration test covers it without the full HTTP stack.
 *   2. Nest DI smoke (`@Inject(SettingsService)` per foot-gun #667 —
 *      tsx + esbuild does NOT emit `design:paramtypes`).
 *
 * The service is mocked via `useValue` (or constructed directly with
 * a `vi.fn()` stub) — every test exercises ONLY the controller method,
 * never the real domain logic.
 */

const SAMPLE_BODY: UpdateSettingsInput = {
  jurisdictions: [{ code: 'AR', enabled: true, customTopics: '' }],
  scanSchedule: 'daily',
  scanDay: 'mon',
  scanHour: 9,
};

const SAMPLE_USER: AuthUser = {
  userId: 'user_actor',
  email: 'actor@example.com',
  memberships: [{ organizationId: 'org_target', orgSlug: 'org-target', role: 'OWNER' as Role }],
};

function buildController(serviceOverrides: Partial<SettingsService> = {}): {
  controller: SettingsController;
  service: SettingsService;
} {
  const service = {
    getOrCreate: vi.fn(),
    update: vi.fn(),
    completeOnboarding: vi.fn(),
    ...serviceOverrides,
  } as unknown as SettingsService;
  const controller = new SettingsController(service);
  return { controller, service };
}

describe('SettingsController', () => {
  describe('decorator metadata (guard contracts)', () => {
    /**
     * Routes are declared with absolute paths because the class
     * `@Controller()` carries no prefix. We verify the `(path, method)`
     * tuple via `Reflector` — if anyone refactors to a controller-level
     * prefix later, this test breaks loudly.
     *
     * NestJS `RequestMethod` enum: GET=0, POST=1, PUT=2, DELETE=3.
     */
    it.each([
      ['get', 'org/:orgId/settings', 0 /* GET */],
      ['update', 'org/:orgId/settings', 2 /* PUT */],
    ])('exposes %s at the spec-mandated path + verb', (handler, expectedPath, expectedVerb) => {
      const fn = (SettingsController.prototype as unknown as Record<string, unknown>)[handler] as
        | ((...args: unknown[]) => unknown)
        | undefined;
      if (!fn) throw new Error(`Handler ${handler} is missing on SettingsController.`);
      const path = Reflect.getMetadata(PATH_METADATA, fn) as string;
      const method = Reflect.getMetadata(METHOD_METADATA, fn) as number;
      expect(path).toBe(expectedPath);
      expect(method).toBe(expectedVerb);
    });

    it('GET has NO @Roles — any member of orgId may read (R-Settings-Get-Or-Create)', () => {
      const reflector = new Reflector();
      const getRoles = reflector.get<Role[] | undefined>(
        ROLES_KEY,
        SettingsController.prototype.get,
      );
      expect(getRoles).toBeUndefined();
    });

    it('locks PUT behind @Roles(OWNER, ADMIN) (R-Settings-Update)', () => {
      const reflector = new Reflector();
      const putRoles = reflector.get<Role[]>(ROLES_KEY, SettingsController.prototype.update);
      expect(putRoles).toEqual(['OWNER', 'ADMIN']);
    });
  });

  describe('handler behavior', () => {
    it('GET — calls service.getOrCreate and serializes Date → ISO under `{ settings }`', async () => {
      const updatedAt = new Date('2026-04-01T10:00:00Z');
      const { controller, service } = buildController({
        getOrCreate: vi.fn().mockResolvedValue({
          organizationId: 'org_target',
          jurisdictions: SAMPLE_BODY.jurisdictions,
          scanSchedule: 'daily',
          scanDay: 'mon',
          scanHour: 9,
          scanDayOfMonth: null,
          updatedAt,
          onboardingCompletedAt: null,
        }),
      });
      const result = await controller.get('org_target', 'org_target');
      expect(service.getOrCreate).toHaveBeenCalledWith('org_target');
      expect(result).toEqual({
        settings: {
          organizationId: 'org_target',
          jurisdictions: SAMPLE_BODY.jurisdictions,
          scanSchedule: 'daily',
          scanDay: 'mon',
          scanHour: 9,
          scanDayOfMonth: null,
          updatedAt: updatedAt.toISOString(),
          onboardingCompletedAt: null,
        },
      });
    });

    it('GET — throws 403 when :orgId mismatches resolved org (assertOrgScope)', async () => {
      const { controller, service } = buildController();
      await expect(controller.get('org_alpha', 'org_beta')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(service.getOrCreate).not.toHaveBeenCalled();
    });

    it('PUT — plumbs orgId + body + actorId to service.update and wraps response', async () => {
      const updatedAt = new Date('2026-04-02T10:00:00Z');
      const { controller, service } = buildController({
        update: vi.fn().mockResolvedValue({
          organizationId: 'org_target',
          jurisdictions: SAMPLE_BODY.jurisdictions,
          scanSchedule: 'daily',
          scanDay: 'mon',
          scanHour: 9,
          scanDayOfMonth: null,
          updatedAt,
          onboardingCompletedAt: null,
        }),
      });
      const result = await controller.update('org_target', SAMPLE_USER, 'org_target', SAMPLE_BODY);
      expect(service.update).toHaveBeenCalledWith('org_target', SAMPLE_BODY, SAMPLE_USER.userId);
      expect(result.settings.updatedAt).toBe(updatedAt.toISOString());
      expect(result.settings.organizationId).toBe('org_target');
    });

    it('PUT — throws 401 when @CurrentUser() is undefined (defence-in-depth past JwtAuthGuard)', async () => {
      const { controller, service } = buildController();
      await expect(
        controller.update('org_target', undefined, 'org_target', SAMPLE_BODY),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(service.update).not.toHaveBeenCalled();
    });

    it('PUT — throws 403 when :orgId mismatches resolved org (assertOrgScope), service NOT called', async () => {
      const { controller, service } = buildController();
      await expect(
        controller.update('org_alpha', SAMPLE_USER, 'org_beta', SAMPLE_BODY),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.update).not.toHaveBeenCalled();
    });
  });

  /**
   * Smoke-level Nest DI check: the controller resolves with an injected
   * service via the `SettingsService` token. This catches the foot-gun
   * #667 regression where someone removes the explicit
   * `@Inject(SettingsService)` and relies on (broken-under-tsx)
   * paramtypes metadata.
   */
  it('resolves through Nest DI with SettingsService injected', async () => {
    const stubService = {
      getOrCreate: vi.fn(),
      update: vi.fn(),
      completeOnboarding: vi.fn(),
    } as unknown as SettingsService;
    const moduleRef = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [{ provide: SettingsService, useValue: stubService }],
    }).compile();
    const controller = moduleRef.get(SettingsController);
    expect(controller).toBeInstanceOf(SettingsController);
    await moduleRef.close();
  });
});
