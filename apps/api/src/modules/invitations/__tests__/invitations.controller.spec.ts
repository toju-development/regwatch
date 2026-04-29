import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { AuthUser, Role } from '@regwatch/types';
import { describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../../../common/auth/decorators/roles.decorator.js';
import { IS_PUBLIC_SCOPE_KEY } from '../../../common/auth/decorators/public-scope.decorator.js';
import { IS_PUBLIC_KEY } from '../../../common/auth/public.decorator.js';
import { InvitationsController } from '../invitations.controller.js';
import { InvitationsService } from '../invitations.service.js';

/**
 * Light unit suite for `InvitationsController`.
 *
 * Spec: `sdd/org-invitations/spec` R-Invitation-Issue, R-Invitations-List,
 *   R-Invitation-Revoke, R-Invitation-Preview, R-Invitation-Accept.
 *
 * Scope: this suite is INTENTIONALLY NOT a full integration test —
 * `invitations.integration.spec.ts` (B4) covers the service + DB
 * contract end-to-end via `InvitationsService` directly. The controller
 * adds three things on top of the service that ARE worth pinning down
 * here without spinning up a Postgres + Nest HTTP listener:
 *
 *   1. Decorator metadata (`@Roles`, `@PublicScope`, `@Public`,
 *      `@Header`, paths, HTTP verbs) — these are guard contracts; if a
 *      handler loses its `@Roles('OWNER','ADMIN')` decorator the wire
 *      authorisation silently degrades to "any member of the org" and
 *      no integration test covers it without the full HTTP stack.
 *
 *   2. The `assertOrgScope` defence-in-depth check — it's controller-
 *      local, has zero effect at the service layer, and would otherwise
 *      need a full HTTP request to exercise.
 *
 *   3. The wire shape mapping (Date → ISO string, omitting `token` from
 *      list/issue responses) — the spec-mandated contract that's
 *      easiest to verify in isolation.
 *
 * The service is mocked via `useValue` — every test exercises ONLY the
 * controller method, never the real domain logic.
 */

const mockUser: AuthUser = {
  userId: 'user_actor',
  email: 'actor@example.com',
  memberships: [{ organizationId: 'org_target', orgSlug: 'org-target', role: 'OWNER' as Role }],
};

function buildController(serviceOverrides: Partial<InvitationsService> = {}): {
  controller: InvitationsController;
  service: InvitationsService;
} {
  const service = {
    issue: vi.fn(),
    list: vi.fn(),
    revoke: vi.fn(),
    preview: vi.fn(),
    accept: vi.fn(),
    ...serviceOverrides,
  } as unknown as InvitationsService;
  const controller = new InvitationsController(service);
  return { controller, service };
}

describe('InvitationsController', () => {
  describe('decorator metadata (guard contracts)', () => {
    /**
     * Routes are declared with absolute paths because the class
     * `@Controller()` carries no prefix. We verify the `(path, method)`
     * tuple via `Reflector` — if anyone refactors to a controller-level
     * prefix later, this test breaks loudly.
     */
    it.each([
      ['issue', 'org/:orgId/invitations', 1 /* POST */],
      ['list', 'org/:orgId/invitations', 0 /* GET */],
      ['revoke', 'org/:orgId/invitations/:invitationId', 3 /* DELETE */],
      ['preview', 'invitations/:token', 0 /* GET */],
      ['accept', 'invitations/:token/accept', 1 /* POST */],
    ])('exposes %s at the spec-mandated path + verb', (handler, expectedPath, expectedVerb) => {
      const fn = (InvitationsController.prototype as unknown as Record<string, unknown>)[
        handler
      ] as ((...args: unknown[]) => unknown) | undefined;
      if (!fn) throw new Error(`Handler ${handler} is missing on InvitationsController.`);
      const path = Reflect.getMetadata(PATH_METADATA, fn) as string;
      const method = Reflect.getMetadata(METHOD_METADATA, fn) as number;
      expect(path).toBe(expectedPath);
      expect(method).toBe(expectedVerb);
    });

    it('locks issue + revoke behind @Roles(OWNER, ADMIN)', () => {
      const reflector = new Reflector();
      const issueRoles = reflector.get<Role[]>(ROLES_KEY, InvitationsController.prototype.issue);
      const revokeRoles = reflector.get<Role[]>(ROLES_KEY, InvitationsController.prototype.revoke);
      expect(issueRoles).toEqual(['OWNER', 'ADMIN']);
      expect(revokeRoles).toEqual(['OWNER', 'ADMIN']);
    });

    it('list has NO @Roles — any member of orgId may list (R-Invitations-List)', () => {
      const reflector = new Reflector();
      const listRoles = reflector.get<Role[] | undefined>(
        ROLES_KEY,
        InvitationsController.prototype.list,
      );
      expect(listRoles).toBeUndefined();
    });

    it('preview is @Public() — anonymous callers reach the route', () => {
      const reflector = new Reflector();
      const isPublic = reflector.get<boolean | undefined>(
        IS_PUBLIC_KEY,
        InvitationsController.prototype.preview,
      );
      expect(isPublic).toBe(true);
    });

    it('accept is @PublicScope() — JWT required but no X-Org-Id', () => {
      const reflector = new Reflector();
      const isPublicScope = reflector.get<boolean | undefined>(
        IS_PUBLIC_SCOPE_KEY,
        InvitationsController.prototype.accept,
      );
      expect(isPublicScope).toBe(true);
      // Critically NOT @Public() — the JWT guard must still run.
      const isPublic = reflector.get<boolean | undefined>(
        IS_PUBLIC_KEY,
        InvitationsController.prototype.accept,
      );
      expect(isPublic).toBeUndefined();
    });
  });

  describe('issue', () => {
    it('serializes Date → ISO and OMITS token from the response (spec R-Invitation-Issue)', async () => {
      const expiresAt = new Date('2026-01-01T00:00:00Z');
      const { controller, service } = buildController({
        issue: vi.fn().mockResolvedValue({
          id: 'inv_1',
          email: 'invitee@example.com',
          role: 'ADMIN',
          expiresAt,
          invitedById: 'user_actor',
          status: 'PENDING',
        }),
      });
      const result = await controller.issue('org_target', mockUser, 'org_target', {
        email: 'invitee@example.com',
        role: 'ADMIN',
      });
      expect(result).toEqual({
        id: 'inv_1',
        email: 'invitee@example.com',
        role: 'ADMIN',
        expiresAt: expiresAt.toISOString(),
        invitedById: 'user_actor',
        status: 'PENDING',
      });
      // No `token` key bled into the wire shape.
      expect(result).not.toHaveProperty('token');
      expect(service.issue).toHaveBeenCalledWith(mockUser, 'org_target', {
        email: 'invitee@example.com',
        role: 'ADMIN',
      });
    });

    it('throws 401 when @CurrentUser() is undefined (defence-in-depth past JwtAuthGuard)', async () => {
      const { controller } = buildController();
      await expect(
        controller.issue('org_target', undefined, 'org_target', {
          email: 'a@b.com',
          role: 'ADMIN',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws 403 when :orgId mismatches resolved org (assertOrgScope)', async () => {
      const { controller, service } = buildController();
      await expect(
        controller.issue('org_alpha', mockUser, 'org_beta', {
          email: 'a@b.com',
          role: 'ADMIN',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.issue).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('strips token, hard-codes status=PENDING, ISO-serializes timestamps', async () => {
      const expiresAt = new Date('2026-02-01T00:00:00Z');
      const createdAt = new Date('2026-01-15T10:00:00Z');
      const { controller } = buildController({
        list: vi.fn().mockResolvedValue([
          {
            id: 'inv_1',
            email: 'a@b.com',
            role: 'ADMIN' as Role,
            expiresAt,
            invitedById: 'user_actor',
            invitedByName: 'Actor',
            createdAt,
          },
        ]),
      });
      const result = await controller.list('org_target', 'org_target');
      expect(result).toEqual({
        invitations: [
          {
            id: 'inv_1',
            email: 'a@b.com',
            role: 'ADMIN',
            status: 'PENDING',
            expiresAt: expiresAt.toISOString(),
            invitedById: 'user_actor',
            invitedByName: 'Actor',
            acceptedAt: null,
            revokedAt: null,
            createdAt: createdAt.toISOString(),
          },
        ],
      });
      expect(result.invitations[0]).not.toHaveProperty('token');
    });
  });

  describe('preview', () => {
    it('returns ONLY display-safe fields (R-Invitation-Preview "no email/orgId leak")', async () => {
      const expiresAt = new Date('2026-03-01T00:00:00Z');
      const { controller } = buildController({
        preview: vi.fn().mockResolvedValue({
          orgName: 'Acme',
          orgSlug: 'acme',
          inviterName: 'Alice',
          role: 'ANALYST' as Role,
          expiresAt,
          status: 'PENDING' as const,
        }),
      });
      const result = await controller.preview('tok_xyz');
      expect(result).toEqual({
        orgName: 'Acme',
        orgSlug: 'acme',
        inviterName: 'Alice',
        role: 'ANALYST',
        expiresAt: expiresAt.toISOString(),
        status: 'PENDING',
      });
      expect(result).not.toHaveProperty('id');
      expect(result).not.toHaveProperty('email');
      expect(result).not.toHaveProperty('organizationId');
    });
  });

  describe('accept', () => {
    it('plumbs the JWT user + token straight to the service (chokepoint contract)', async () => {
      const { controller, service } = buildController({
        accept: vi.fn().mockResolvedValue({ orgId: 'org_target', role: 'ADMIN' as Role }),
      });
      const result = await controller.accept('tok_xyz', mockUser);
      expect(result).toEqual({ orgId: 'org_target', role: 'ADMIN' });
      expect(service.accept).toHaveBeenCalledWith(mockUser, 'tok_xyz');
    });

    it('throws 401 when @CurrentUser() is undefined (defence-in-depth past JwtAuthGuard)', async () => {
      const { controller } = buildController();
      await expect(controller.accept('tok_xyz', undefined)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  /**
   * Smoke-level Nest DI check: the controller resolves with an injected
   * service via the `InvitationsService` token. This catches the
   * foot-gun #667 regression where someone removes the explicit
   * `@Inject(InvitationsService)` and relies on (broken-under-tsx)
   * paramtypes metadata.
   */
  it('resolves through Nest DI with InvitationsService injected', async () => {
    const stubService = { issue: vi.fn() } as unknown as InvitationsService;
    const moduleRef = await Test.createTestingModule({
      controllers: [InvitationsController],
      providers: [{ provide: InvitationsService, useValue: stubService }],
    }).compile();
    const controller = moduleRef.get(InvitationsController);
    expect(controller).toBeInstanceOf(InvitationsController);
    await moduleRef.close();
  });
});
