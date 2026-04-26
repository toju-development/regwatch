import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../auth.module.js';
import { JwtAuthGuard } from '../jwt-auth.guard.js';
import { OrgScopeGuard } from '../org-scope.guard.js';
import { RolesGuard } from '../roles.guard.js';

/**
 * Spec: `sdd/auth-authorization-guards/spec` R "Guard Registration Order
 * Is Contract".
 * Design: `sdd/auth-authorization-guards/design` §1 — guard execution
 * order is determined by the `providers[]` declaration order in
 * `AuthModule`. NestJS executes APP_GUARD entries in registration order,
 * so the order in `providers[]` IS the contract.
 *
 * This spec introspects `AuthModule`'s decorator metadata directly
 * (no DI bootstrap required) and asserts the three `APP_GUARD` entries
 * appear in `[JwtAuthGuard, OrgScopeGuard, RolesGuard]` order.
 */

interface AppGuardProvider {
  provide: typeof APP_GUARD;
  useClass: new (...args: unknown[]) => unknown;
}

function isAppGuardProvider(p: unknown): p is AppGuardProvider {
  return (
    typeof p === 'object' &&
    p !== null &&
    'provide' in p &&
    (p as { provide: unknown }).provide === APP_GUARD &&
    'useClass' in p
  );
}

describe('AuthModule provider registration order', () => {
  it('registers APP_GUARDs in [JwtAuthGuard, OrgScopeGuard, RolesGuard] order', () => {
    const providers = (Reflect.getMetadata('providers', AuthModule) ?? []) as unknown[];
    const guardClasses = providers.filter(isAppGuardProvider).map((p) => p.useClass);

    expect(guardClasses).toEqual([JwtAuthGuard, OrgScopeGuard, RolesGuard]);
  });

  it('exposes exactly three APP_GUARD providers (no duplicates, no extras)', () => {
    const providers = (Reflect.getMetadata('providers', AuthModule) ?? []) as unknown[];
    const appGuards = providers.filter(isAppGuardProvider);

    expect(appGuards).toHaveLength(3);
  });
});
