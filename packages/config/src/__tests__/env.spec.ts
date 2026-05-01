import { describe, expect, it } from 'vitest';
import { createCoreEnv } from '../core.js';
import { createWebEnv, parseInvitedEmails } from '../web.js';
import { createApiEnv } from '../api.js';

const VALID_SECRET = 'a'.repeat(48); // ≥32 chars
const VALID_DB = 'postgresql://user:pass@localhost:5432/regwatch';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: VALID_DB,
  AUTH_SECRET: VALID_SECRET,
};

/**
 * Baseline runtimeEnv for `createWebEnv` tests. Includes EVERY var the web
 * schema marks as required so each test only has to override the var(s)
 * under test.
 *
 * Why this exists (foot-gun, see engram
 * `regwatch/footguns/t3-oss-env-core-tests-leak-process-env`):
 * `@t3-oss/env-core` validates `runtimeEnv` against the schema; if a
 * required key is absent it throws. Locally the dev shell may export
 * `API_URL` etc. and the test appears to pass via process.env leakage,
 * but CI runs with a clean env and the missing key surfaces. Tests MUST
 * pass a complete `runtimeEnv` — never rely on the ambient shell.
 */
const validWebEnv = () => ({
  ...baseEnv,
  API_URL: 'http://localhost:4000',
});

describe('createCoreEnv', () => {
  it('parses a valid env', () => {
    const env = createCoreEnv({ ...baseEnv });
    expect(env.AUTH_SECRET).toBe(VALID_SECRET);
    expect(env.DATABASE_URL).toBe(VALID_DB);
    expect(env.NODE_ENV).toBe('test');
    expect(env.JWT_ISSUER).toBeUndefined();
    expect(env.JWT_AUDIENCE).toBeUndefined();
  });

  it('threads optional JWT_ISSUER / JWT_AUDIENCE when present', () => {
    const env = createCoreEnv({
      ...baseEnv,
      JWT_ISSUER: 'regwatch-web',
      JWT_AUDIENCE: 'regwatch-api',
    });
    expect(env.JWT_ISSUER).toBe('regwatch-web');
    expect(env.JWT_AUDIENCE).toBe('regwatch-api');
  });

  it('rejects AUTH_SECRET shorter than 32 chars', () => {
    expect(() => createCoreEnv({ ...baseEnv, AUTH_SECRET: 'too-short' })).toThrow();
  });

  it('rejects missing DATABASE_URL', () => {
    const rest: Record<string, string | undefined> = { ...baseEnv };
    delete rest.DATABASE_URL;
    expect(() => createCoreEnv(rest)).toThrow();
  });
});

describe('createApiEnv', () => {
  it('exposes core + PORT only — NO web-only keys', () => {
    const env = createApiEnv({ ...baseEnv, PORT: '4000' });
    expect(env.PORT).toBe(4000);
    expect(env.AUTH_SECRET).toBe(VALID_SECRET);
    // Web-only keys MUST NOT leak into the api slice (spec scenario:
    // "API loads only api+core slice").
    const keys = Object.keys(env);
    for (const banned of [
      'AUTH_URL',
      'AUTH_GOOGLE_ID',
      'AUTH_GOOGLE_SECRET',
      'AUTH_RESEND_KEY',
      'AUTH_EMAIL_FROM',
      'EMAIL_TRANSPORT',
      'AUTH_FAKE_GOOGLE',
      'REGISTRATION_ENABLED',
      'INVITED_EMAILS',
    ]) {
      expect(keys).not.toContain(banned);
    }
  });

  it('rejects short AUTH_SECRET (inherited from core)', () => {
    expect(() => createApiEnv({ ...baseEnv, AUTH_SECRET: 'nope' })).toThrow();
  });

  it('defaults MEMBERSHIPS_FRESHNESS_TTL_MS to 30000 when unset (sdd/org-members B2)', () => {
    const env = createApiEnv({ ...baseEnv });
    expect(env.MEMBERSHIPS_FRESHNESS_TTL_MS).toBe(30000);
  });

  it('coerces MEMBERSHIPS_FRESHNESS_TTL_MS from string and accepts 0 (cache-disabled mode)', () => {
    const env = createApiEnv({ ...baseEnv, MEMBERSHIPS_FRESHNESS_TTL_MS: '0' });
    expect(env.MEMBERSHIPS_FRESHNESS_TTL_MS).toBe(0);
  });

  it('rejects negative MEMBERSHIPS_FRESHNESS_TTL_MS', () => {
    expect(() => createApiEnv({ ...baseEnv, MEMBERSHIPS_FRESHNESS_TTL_MS: '-1' })).toThrow();
  });
});

describe('createWebEnv', () => {
  it('composes core + web vars with sensible dev defaults', () => {
    const env = createWebEnv({ ...validWebEnv() });
    expect(env.AUTH_SECRET).toBe(VALID_SECRET); // inherited from core
    expect(env.EMAIL_TRANSPORT).toBe('memory'); // default per operator decision
    expect(env.AUTH_FAKE_GOOGLE).toBe(false); // default '0' coerced to boolean
    expect(env.AUTH_GOOGLE_ID).toBeUndefined();
    expect(env.AUTH_RESEND_KEY).toBeUndefined();
  });

  it('coerces AUTH_FAKE_GOOGLE="1" to boolean true', () => {
    const env = createWebEnv({ ...validWebEnv(), AUTH_FAKE_GOOGLE: '1' });
    expect(env.AUTH_FAKE_GOOGLE).toBe(true);
  });

  it('rejects EMAIL_TRANSPORT outside the enum', () => {
    expect(() => createWebEnv({ ...validWebEnv(), EMAIL_TRANSPORT: 'smtp' })).toThrow();
  });

  it('accepts EMAIL_TRANSPORT="resend" with provider keys populated', () => {
    const env = createWebEnv({
      ...validWebEnv(),
      EMAIL_TRANSPORT: 'resend',
      AUTH_RESEND_KEY: 're_test_xxx',
      AUTH_EMAIL_FROM: 'noreply@regwatch.local',
      AUTH_GOOGLE_ID: 'g-id',
      AUTH_GOOGLE_SECRET: 'g-secret',
      AUTH_URL: 'http://localhost:3000',
    });
    expect(env.EMAIL_TRANSPORT).toBe('resend');
    expect(env.AUTH_RESEND_KEY).toBe('re_test_xxx');
    expect(env.AUTH_EMAIL_FROM).toBe('noreply@regwatch.local');
    expect(env.AUTH_URL).toBe('http://localhost:3000');
  });

  it('rejects malformed AUTH_EMAIL_FROM', () => {
    expect(() => createWebEnv({ ...validWebEnv(), AUTH_EMAIL_FROM: 'not-an-email' })).toThrow();
  });

  // -------------------------------------------------------------------
  // Registration block (sdd/scanner-vertical-ar B8 / BIZ-4 — #721)
  // Spec R-15-RegistrationGate / Design ADR-13.
  // -------------------------------------------------------------------

  it('REGISTRATION_ENABLED defaults to false (closed) when unset', () => {
    const env = createWebEnv({ ...validWebEnv() });
    expect(env.REGISTRATION_ENABLED).toBe(false);
    expect(env.INVITED_EMAILS).toBeInstanceOf(Set);
    expect(env.INVITED_EMAILS.size).toBe(0);
  });

  it('REGISTRATION_ENABLED="1" coerces to boolean true', () => {
    const env = createWebEnv({ ...validWebEnv(), REGISTRATION_ENABLED: '1' });
    expect(env.REGISTRATION_ENABLED).toBe(true);
  });

  it('REGISTRATION_ENABLED rejects values outside the 0/1 enum (NOT z.coerce.boolean)', () => {
    // Foot-gun guard: `z.coerce.boolean()` would silently treat "false" as
    // truthy. The 0/1 enum is intentional — see web.ts inline comment.
    expect(() => createWebEnv({ ...validWebEnv(), REGISTRATION_ENABLED: 'false' })).toThrow();
    expect(() => createWebEnv({ ...validWebEnv(), REGISTRATION_ENABLED: 'true' })).toThrow();
  });

  it('INVITED_EMAILS empty string parses to an empty Set', () => {
    const env = createWebEnv({ ...validWebEnv(), INVITED_EMAILS: '' });
    expect(env.INVITED_EMAILS.size).toBe(0);
  });

  it('INVITED_EMAILS whitespace-only string parses to an empty Set', () => {
    const env = createWebEnv({ ...validWebEnv(), INVITED_EMAILS: '   ' });
    expect(env.INVITED_EMAILS.size).toBe(0);
  });

  it('INVITED_EMAILS CSV is split, trimmed, lowercased, and stored as a Set', () => {
    const env = createWebEnv({
      ...validWebEnv(),
      INVITED_EMAILS: ' Alice@Example.com, BOB@x.io ,carol@x.io',
    });
    expect(env.INVITED_EMAILS.has('alice@example.com')).toBe(true);
    expect(env.INVITED_EMAILS.has('bob@x.io')).toBe(true);
    expect(env.INVITED_EMAILS.has('carol@x.io')).toBe(true);
    expect(env.INVITED_EMAILS.size).toBe(3);
  });

  it('INVITED_EMAILS tolerates trailing commas and double commas', () => {
    const env = createWebEnv({ ...validWebEnv(), INVITED_EMAILS: 'a@b.io,,c@d.io,' });
    expect(env.INVITED_EMAILS.size).toBe(2);
    expect(env.INVITED_EMAILS.has('a@b.io')).toBe(true);
    expect(env.INVITED_EMAILS.has('c@d.io')).toBe(true);
  });

  it('INVITED_EMAILS fail-fast on a single malformed entry (no silent drop)', () => {
    // t3-env wraps the underlying Zod issue in a generic
    // "Invalid environment variables" Error and logs the original
    // INVITED_EMAILS message to stderr (foot-gun: cannot regex-match the
    // wrapped Error.message). Asserting `.toThrow()` is enough — the
    // helper-level test below pins the exact wording.
    expect(() =>
      createWebEnv({ ...validWebEnv(), INVITED_EMAILS: 'alice@x.io,not-an-email' }),
    ).toThrow();
  });
});

describe('parseInvitedEmails (helper)', () => {
  it('throws with the offending entry quoted in the message', () => {
    // Exercises the helper directly to pin the message contract that
    // operators rely on when chasing boot-time failures.
    expect(() => parseInvitedEmails('alice@x.io, broken')).toThrow(/"broken"/);
  });

  it('throws with INVITED_EMAILS named in the message', () => {
    expect(() => parseInvitedEmails('not-an-email')).toThrow(/INVITED_EMAILS/);
  });
});
