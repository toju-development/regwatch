/**
 * Unit tests for `InternalSecretGuard`.
 *
 * Strategy: build a minimal fake `ExecutionContext` without NestJS TestingModule.
 * This keeps tests fast and side-effect-free.
 *
 * Scenarios:
 *   - Valid secret header → `canActivate` returns `true`
 *   - Missing header → throws `UnauthorizedException` (→ 401)
 *   - Wrong secret → throws `UnauthorizedException` (→ 401)
 *   - `SCANNER_INTERNAL_SECRET` not set → throws `InternalServerErrorException`
 *
 * Spec: sdd/manual-ingestion B3.4.
 */
import 'reflect-metadata';
import { InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InternalSecretGuard } from '../internal-secret.guard.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(headers: Record<string, string | undefined>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('InternalSecretGuard', () => {
  const ORIGINAL_ENV = process.env['SCANNER_INTERNAL_SECRET'];

  beforeEach(() => {
    process.env['SCANNER_INTERNAL_SECRET'] = 'super-secret-value';
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env['SCANNER_INTERNAL_SECRET'];
    } else {
      process.env['SCANNER_INTERNAL_SECRET'] = ORIGINAL_ENV;
    }
  });

  it('returns true when the X-Internal-Secret header matches', () => {
    const guard = new InternalSecretGuard();
    const ctx = makeContext({ 'x-internal-secret': 'super-secret-value' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws UnauthorizedException when the X-Internal-Secret header is missing', () => {
    const guard = new InternalSecretGuard();
    const ctx = makeContext({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the X-Internal-Secret header is wrong', () => {
    const guard = new InternalSecretGuard();
    const ctx = makeContext({ 'x-internal-secret': 'wrong-secret' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws InternalServerErrorException when SCANNER_INTERNAL_SECRET is not set', () => {
    delete process.env['SCANNER_INTERNAL_SECRET'];
    const guard = new InternalSecretGuard();
    const ctx = makeContext({ 'x-internal-secret': 'any-value' });
    expect(() => guard.canActivate(ctx)).toThrow(InternalServerErrorException);
  });
});
