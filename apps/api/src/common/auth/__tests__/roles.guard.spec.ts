import { ExecutionContext, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { Role } from '@regwatch/types';
import { RolesGuard } from '../roles.guard.js';
import { IS_PUBLIC_KEY } from '../public.decorator.js';
import { IS_PUBLIC_SCOPE_KEY } from '../decorators/public-scope.decorator.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

/**
 * Spec: `sdd/auth-authorization-guards/spec` R "RolesGuard Enforces Role Matrix".
 * Scenarios covered (canonical Role values: OWNER | ADMIN | ANALYST | VIEWER —
 * NO `MEMBER`, per B4 carry-forward):
 *
 *  1. @Public() route → returns true (transitive bypass)
 *  2. @PublicScope() route → returns true (no org context → vacuous)
 *  3. No @Roles() declared → returns true (no restriction)
 *  4. @Roles() declared empty array → returns true (no restriction)
 *  5. @Roles(OWNER) + membership.role=OWNER → allow
 *  6. @Roles(OWNER, ADMIN) + membership.role=ADMIN → allow (ANY-of)
 *  7. @Roles(OWNER) + membership.role=VIEWER → ForbiddenException
 *  8. @Roles(OWNER) + missing request.membership → InternalServerErrorException
 */

interface FakeReq {
  membership?: { organizationId: string; role: Role; orgSlug: string };
}

function makeContext(req: FakeReq): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T>() => req as unknown as T,
      getResponse: <T>() => ({}) as T,
      getNext: <T>() => ({}) as T,
    }),
    getHandler: () => () => undefined,
    getClass: () => class Dummy {},
  } as unknown as ExecutionContext;
}

/**
 * Reflector mock keyed by metadata key. `RolesGuard` reads in order:
 * `IS_PUBLIC_KEY`, `IS_PUBLIC_SCOPE_KEY`, `ROLES_KEY`.
 */
function makeReflector(opts: {
  isPublic?: boolean;
  isPublicScope?: boolean;
  roles?: Role[] | undefined;
}): Reflector {
  return {
    getAllAndOverride: vi.fn((key: string) => {
      if (key === IS_PUBLIC_KEY) return opts.isPublic ?? false;
      if (key === IS_PUBLIC_SCOPE_KEY) return opts.isPublicScope ?? false;
      if (key === ROLES_KEY) return opts.roles;
      return undefined;
    }),
  } as unknown as Reflector;
}

function membership(role: Role): { organizationId: string; role: Role; orgSlug: string } {
  return { organizationId: 'org_x', orgSlug: 'x', role };
}

describe('RolesGuard', () => {
  it('@Public() route short-circuits (returns true) regardless of @Roles', () => {
    const guard = new RolesGuard(makeReflector({ isPublic: true, roles: ['OWNER'] }));
    const req: FakeReq = {};
    expect(guard.canActivate(makeContext(req))).toBe(true);
  });

  it('@PublicScope() route short-circuits (returns true) — no org context', () => {
    const guard = new RolesGuard(makeReflector({ isPublicScope: true, roles: ['OWNER'] }));
    const req: FakeReq = {};
    expect(guard.canActivate(makeContext(req))).toBe(true);
  });

  it('no @Roles() declared (metadata undefined) returns true (no restriction)', () => {
    const guard = new RolesGuard(makeReflector({ roles: undefined }));
    const req: FakeReq = { membership: membership('VIEWER') };
    expect(guard.canActivate(makeContext(req))).toBe(true);
  });

  it('@Roles() declared empty array returns true (treated as no restriction)', () => {
    const guard = new RolesGuard(makeReflector({ roles: [] }));
    const req: FakeReq = { membership: membership('VIEWER') };
    expect(guard.canActivate(makeContext(req))).toBe(true);
  });

  it('@Roles(OWNER) allows membership.role=OWNER', () => {
    const guard = new RolesGuard(makeReflector({ roles: ['OWNER'] }));
    const req: FakeReq = { membership: membership('OWNER') };
    expect(guard.canActivate(makeContext(req))).toBe(true);
  });

  it('@Roles(OWNER, ADMIN) allows membership.role=ADMIN (ANY-of semantics)', () => {
    const guard = new RolesGuard(makeReflector({ roles: ['OWNER', 'ADMIN'] }));
    const req: FakeReq = { membership: membership('ADMIN') };
    expect(guard.canActivate(makeContext(req))).toBe(true);
  });

  it('@Roles(OWNER) throws ForbiddenException when membership.role=VIEWER', () => {
    const guard = new RolesGuard(makeReflector({ roles: ['OWNER'] }));
    const req: FakeReq = { membership: membership('VIEWER') };
    expect(() => guard.canActivate(makeContext(req))).toThrow(ForbiddenException);
  });

  it('@Roles(OWNER) throws InternalServerErrorException when request.membership is missing (defensive — OrgScopeGuard wiring bug)', () => {
    const guard = new RolesGuard(makeReflector({ roles: ['OWNER'] }));
    const req: FakeReq = {};
    expect(() => guard.canActivate(makeContext(req))).toThrow(InternalServerErrorException);
  });
});
