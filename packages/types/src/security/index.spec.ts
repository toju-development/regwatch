import { describe, expect, it } from 'vitest';

import { assertNoForbiddenKeys } from './index.js';

describe('assertNoForbiddenKeys', () => {
  const FORBIDDEN = ['organizationId', 'userId', 'email'] as const;

  // ── happy paths ─────────────────────────────────────────────────────────
  it('passes for a flat clean object', () => {
    expect(() =>
      assertNoForbiddenKeys({ topic: 'FX', relevanceScore: 80 }, FORBIDDEN),
    ).not.toThrow();
  });

  it('passes for nested clean object', () => {
    expect(() =>
      assertNoForbiddenKeys({ outer: { inner: { value: 42 } } }, FORBIDDEN),
    ).not.toThrow();
  });

  it('passes for array of clean objects', () => {
    expect(() =>
      assertNoForbiddenKeys([{ topic: 'FX' }, { topic: 'AML' }], FORBIDDEN),
    ).not.toThrow();
  });

  it('passes for null and primitives', () => {
    expect(() => assertNoForbiddenKeys(null, FORBIDDEN)).not.toThrow();
    expect(() => assertNoForbiddenKeys(undefined, FORBIDDEN)).not.toThrow();
    expect(() => assertNoForbiddenKeys(42, FORBIDDEN)).not.toThrow();
    expect(() => assertNoForbiddenKeys('string', FORBIDDEN)).not.toThrow();
  });

  it('passes when forbidden list is empty', () => {
    expect(() => assertNoForbiddenKeys({ organizationId: 'evil' }, [])).not.toThrow();
  });

  // ── forbidden key detection ───────────────────────────────────────────────
  it('throws on exact match: organizationId', () => {
    expect(() => assertNoForbiddenKeys({ organizationId: 'org_123' }, FORBIDDEN)).toThrow(
      'forbidden key "organizationId"',
    );
  });

  it('throws on camelCase variant: OrganizationId', () => {
    expect(() => assertNoForbiddenKeys({ OrganizationId: 'org_123' }, FORBIDDEN)).toThrow(
      'forbidden key "OrganizationId"',
    );
  });

  it('throws on snake_case variant: organization_id', () => {
    expect(() => assertNoForbiddenKeys({ organization_id: 'org_123' }, FORBIDDEN)).toThrow(
      'forbidden key "organization_id"',
    );
  });

  it('throws on kebab variant: organization-id', () => {
    expect(() => assertNoForbiddenKeys({ 'organization-id': 'org_123' }, FORBIDDEN)).toThrow(
      'forbidden key "organization-id"',
    );
  });

  it('throws on SCREAMING variant: ORGANIZATIONID', () => {
    expect(() => assertNoForbiddenKeys({ ORGANIZATIONID: 'org_123' }, FORBIDDEN)).toThrow(
      'forbidden key "ORGANIZATIONID"',
    );
  });

  it('throws on userId', () => {
    expect(() => assertNoForbiddenKeys({ userId: 'user_abc' }, FORBIDDEN)).toThrow(
      'forbidden key "userId"',
    );
  });

  it('throws on email', () => {
    expect(() => assertNoForbiddenKeys({ email: 'x@y.com' }, FORBIDDEN)).toThrow(
      'forbidden key "email"',
    );
  });

  // ── nested detection ─────────────────────────────────────────────────────
  it('throws for forbidden key nested in object', () => {
    expect(() =>
      assertNoForbiddenKeys(
        { executiveSummary: 'ok', meta: { organizationId: 'evil' } },
        FORBIDDEN,
      ),
    ).toThrow('forbidden key "organizationId"');
  });

  it('throws for forbidden key nested in array', () => {
    expect(() =>
      assertNoForbiddenKeys({ citations: [{ organizationId: 'evil' }] }, FORBIDDEN),
    ).toThrow('forbidden key "organizationId"');
  });

  it('throws for forbidden key in deeply nested structure', () => {
    expect(() =>
      assertNoForbiddenKeys({ a: { b: { c: { organizationId: 'evil' } } } }, FORBIDDEN),
    ).toThrow('forbidden key "organizationId"');
  });

  // ── error message quality ────────────────────────────────────────────────
  it('includes path information in the error message', () => {
    let caught: Error | undefined;
    try {
      assertNoForbiddenKeys({ meta: { organizationId: 'evil' } }, FORBIDDEN);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain('meta.organizationId');
  });

  it('error lists the forbidden keys', () => {
    expect(() => assertNoForbiddenKeys({ organizationId: 'x' }, FORBIDDEN)).toThrow(
      'organizationId, userId, email',
    );
  });
});
