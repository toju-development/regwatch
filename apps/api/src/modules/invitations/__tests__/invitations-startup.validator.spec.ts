import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InvitationsStartupValidator } from '../invitations-startup.validator.js';

/**
 * Spec: `sdd/org-invitations/spec` R-Email-Port-Hexagonal "TTL and
 *   acceptUrl base are configuration, not code".
 * Design: `sdd/org-invitations/design` §1 (env contract).
 *
 * The validator's job is fail-fast at boot. We exercise `onModuleInit()`
 * directly (no Nest test module needed — the validator has zero
 * collaborators) under a mutated `process.env` snapshot, restoring the
 * original after each case so the suite is order-independent.
 */

const ENV_KEYS = ['INVITATION_TTL_DAYS', 'WEB_URL', 'NODE_ENV'] as const;

describe('InvitationsStartupValidator', () => {
  const original: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) original[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  describe('INVITATION_TTL_DAYS', () => {
    it('passes when unset (module falls back to 7)', () => {
      delete process.env['INVITATION_TTL_DAYS'];
      process.env['NODE_ENV'] = 'test';
      process.env['WEB_URL'] = 'http://localhost:3000';
      expect(() => new InvitationsStartupValidator().onModuleInit()).not.toThrow();
    });

    it('passes when set to a positive integer string', () => {
      process.env['INVITATION_TTL_DAYS'] = '14';
      process.env['NODE_ENV'] = 'test';
      process.env['WEB_URL'] = 'http://localhost:3000';
      expect(() => new InvitationsStartupValidator().onModuleInit()).not.toThrow();
    });

    it('throws on a non-numeric value (would silently NaN at issue-time)', () => {
      process.env['INVITATION_TTL_DAYS'] = '7d';
      process.env['NODE_ENV'] = 'test';
      expect(() => new InvitationsStartupValidator().onModuleInit()).toThrow(
        /INVITATION_TTL_DAYS must be a positive integer/,
      );
    });

    it('throws on zero / negative integers', () => {
      process.env['INVITATION_TTL_DAYS'] = '-3';
      process.env['NODE_ENV'] = 'test';
      expect(() => new InvitationsStartupValidator().onModuleInit()).toThrow(
        /INVITATION_TTL_DAYS must be a positive integer/,
      );
    });
  });

  describe('WEB_URL', () => {
    it('throws in production when WEB_URL is unset (acceptUrls would point at localhost)', () => {
      process.env['NODE_ENV'] = 'production';
      delete process.env['WEB_URL'];
      delete process.env['INVITATION_TTL_DAYS'];
      expect(() => new InvitationsStartupValidator().onModuleInit()).toThrow(
        /WEB_URL is required in NODE_ENV=production/,
      );
    });

    it('passes in production when WEB_URL is a valid URL', () => {
      process.env['NODE_ENV'] = 'production';
      process.env['WEB_URL'] = 'https://app.regwatch.dev';
      delete process.env['INVITATION_TTL_DAYS'];
      expect(() => new InvitationsStartupValidator().onModuleInit()).not.toThrow();
    });

    it('throws when WEB_URL is malformed', () => {
      process.env['NODE_ENV'] = 'test';
      process.env['WEB_URL'] = 'not a url';
      delete process.env['INVITATION_TTL_DAYS'];
      expect(() => new InvitationsStartupValidator().onModuleInit()).toThrow(
        /WEB_URL must be a valid URL/,
      );
    });

    it('passes in dev when WEB_URL is unset (module falls back to localhost)', () => {
      process.env['NODE_ENV'] = 'development';
      delete process.env['WEB_URL'];
      delete process.env['INVITATION_TTL_DAYS'];
      expect(() => new InvitationsStartupValidator().onModuleInit()).not.toThrow();
    });
  });
});
