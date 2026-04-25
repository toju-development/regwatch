import { describe, expect, it } from 'vitest';
import { createCoreEnv } from '../core.js';
import { createWebEnv } from '../web.js';
import { createApiEnv } from '../api.js';

const VALID_SECRET = 'a'.repeat(48); // ≥32 chars
const VALID_DB = 'postgresql://user:pass@localhost:5432/regwatch';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: VALID_DB,
  AUTH_SECRET: VALID_SECRET,
};

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
    ]) {
      expect(keys).not.toContain(banned);
    }
  });

  it('rejects short AUTH_SECRET (inherited from core)', () => {
    expect(() => createApiEnv({ ...baseEnv, AUTH_SECRET: 'nope' })).toThrow();
  });
});

describe('createWebEnv', () => {
  it('composes core + web vars with sensible dev defaults', () => {
    const env = createWebEnv({ ...baseEnv });
    expect(env.AUTH_SECRET).toBe(VALID_SECRET); // inherited from core
    expect(env.EMAIL_TRANSPORT).toBe('memory'); // default per operator decision
    expect(env.AUTH_FAKE_GOOGLE).toBe(false); // default '0' coerced to boolean
    expect(env.AUTH_GOOGLE_ID).toBeUndefined();
    expect(env.AUTH_RESEND_KEY).toBeUndefined();
  });

  it('coerces AUTH_FAKE_GOOGLE="1" to boolean true', () => {
    const env = createWebEnv({ ...baseEnv, AUTH_FAKE_GOOGLE: '1' });
    expect(env.AUTH_FAKE_GOOGLE).toBe(true);
  });

  it('rejects EMAIL_TRANSPORT outside the enum', () => {
    expect(() => createWebEnv({ ...baseEnv, EMAIL_TRANSPORT: 'smtp' })).toThrow();
  });

  it('accepts EMAIL_TRANSPORT="resend" with provider keys populated', () => {
    const env = createWebEnv({
      ...baseEnv,
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
    expect(() => createWebEnv({ ...baseEnv, AUTH_EMAIL_FROM: 'not-an-email' })).toThrow();
  });
});
