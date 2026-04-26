import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { Role } from '@regwatch/types';
import { MeController } from '../__test-only__/me.controller.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { IS_PUBLIC_SCOPE_KEY } from '../decorators/public-scope.decorator.js';
import { IS_PUBLIC_KEY } from '../public.decorator.js';

/**
 * Canary integration spec — verifies the decorator matrix from design §1
 * is correctly stamped on the test-only `MeController` handlers. A full
 * HTTP integration test would require `supertest` (not in deps) plus a
 * stubbed `JwtVerifier`; per task B6 fallback, we verify metadata via
 * Reflector — sufficient because each individual guard is already covered
 * by its own unit spec (B4/B5/MVP-3a).
 *
 * Coverage:
 *
 * | Path                     | IS_PUBLIC_KEY | IS_PUBLIC_SCOPE_KEY | ROLES_KEY              |
 * |--------------------------|---------------|---------------------|------------------------|
 * | `GET /me`                | (unset)       | (unset)             | (unset)                |
 * | `GET /me/public`         | true          | (unset)             | (unset)                |
 * | `GET /me/public-scope`   | (unset)       | true                | (unset)                |
 * | `GET /me/owner-only`     | (unset)       | (unset)             | ['OWNER']              |
 * | `GET /me/admin-or-owner` | (unset)       | (unset)             | ['OWNER', 'ADMIN']     |
 *
 * Spec: `sdd/auth-authorization-guards/spec` (all R's, decorator matrix).
 * Design: `sdd/auth-authorization-guards/design` §1, §5.
 */

function meta<T = unknown>(key: string, target: object | undefined): T | undefined {
  if (!target) return undefined;
  return Reflect.getMetadata(key, target) as T | undefined;
}

describe('Auth decorator matrix on MeController', () => {
  const proto = MeController.prototype as unknown as Record<
    string,
    ((...args: unknown[]) => unknown) | undefined
  >;

  it('GET /me — default — no auth metadata stamped', () => {
    expect(meta<boolean>(IS_PUBLIC_KEY, proto.me)).toBeUndefined();
    expect(meta<boolean>(IS_PUBLIC_SCOPE_KEY, proto.me)).toBeUndefined();
    expect(meta<Role[]>(ROLES_KEY, proto.me)).toBeUndefined();
  });

  it('GET /me/public — @Public() only', () => {
    expect(meta<boolean>(IS_PUBLIC_KEY, proto.mePublic)).toBe(true);
    expect(meta<boolean>(IS_PUBLIC_SCOPE_KEY, proto.mePublic)).toBeUndefined();
    expect(meta<Role[]>(ROLES_KEY, proto.mePublic)).toBeUndefined();
  });

  it('GET /me/public-scope — @PublicScope() only', () => {
    expect(meta<boolean>(IS_PUBLIC_KEY, proto.mePublicScope)).toBeUndefined();
    expect(meta<boolean>(IS_PUBLIC_SCOPE_KEY, proto.mePublicScope)).toBe(true);
    expect(meta<Role[]>(ROLES_KEY, proto.mePublicScope)).toBeUndefined();
  });

  it('GET /me/owner-only — @Roles(OWNER)', () => {
    expect(meta<boolean>(IS_PUBLIC_KEY, proto.meOwnerOnly)).toBeUndefined();
    expect(meta<boolean>(IS_PUBLIC_SCOPE_KEY, proto.meOwnerOnly)).toBeUndefined();
    expect(meta<Role[]>(ROLES_KEY, proto.meOwnerOnly)).toEqual(['OWNER']);
  });

  it('GET /me/admin-or-owner — @Roles(OWNER, ADMIN) ANY-of', () => {
    expect(meta<boolean>(IS_PUBLIC_KEY, proto.meAdminOrOwner)).toBeUndefined();
    expect(meta<boolean>(IS_PUBLIC_SCOPE_KEY, proto.meAdminOrOwner)).toBeUndefined();
    expect(meta<Role[]>(ROLES_KEY, proto.meAdminOrOwner)).toEqual(['OWNER', 'ADMIN']);
  });

  it('matrix is exhaustive — every documented handler exists on the controller', () => {
    const expected = ['me', 'mePublic', 'mePublicScope', 'meOwnerOnly', 'meAdminOrOwner'];
    for (const m of expected) {
      expect(typeof proto[m]).toBe('function');
    }
  });
});
