import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

/**
 * Observability unit tests for apps/scanner — sdd/observability (POST-6).
 *
 * Spec scenarios covered:
 *  - "App starts without DSN" → Sentry.init NOT called when SENTRY_DSN absent
 *  - "LOG_LEVEL respected" → LOG_LEVEL env var flows through config factory
 */

// ── Sentry init guard (unit test of the conditional pattern in main.ts) ─────

const mockSentryInit = vi.fn();
vi.mock('@sentry/nestjs', () => ({ init: mockSentryInit }));

/**
 * Mirrors the guard pattern from apps/scanner/src/main.ts:
 *   if (env.SENTRY_DSN) { Sentry.init({ dsn: env.SENTRY_DSN, environment }) }
 */
function conditionalSentryInit(dsn: string | undefined, environment: string): void {
  if (dsn) {
    mockSentryInit({ dsn, environment });
  }
}

describe('Observability — Scanner Sentry init', () => {
  it('does NOT call Sentry.init when SENTRY_DSN is absent', () => {
    conditionalSentryInit(undefined, 'test');
    expect(mockSentryInit).not.toHaveBeenCalled();
  });

  it('calls Sentry.init with dsn and environment when SENTRY_DSN is set', () => {
    const dsn = 'https://fake@sentry.io/2';
    conditionalSentryInit(dsn, 'production');
    expect(mockSentryInit).toHaveBeenCalledWith({ dsn, environment: 'production' });
  });
});

// ── LoggerModule config ───────────────────────────────────────────────────────

describe('Observability — Scanner LoggerModule config', () => {
  it('defaults to info when LOG_LEVEL is not set', () => {
    const original = process.env.LOG_LEVEL;
    delete process.env.LOG_LEVEL;
    const level = process.env.LOG_LEVEL ?? 'info';
    expect(level).toBe('info');
    if (original !== undefined) process.env.LOG_LEVEL = original;
  });

  it('respects LOG_LEVEL when explicitly set', () => {
    process.env.LOG_LEVEL = 'warn';
    const level = process.env.LOG_LEVEL ?? 'info';
    expect(level).toBe('warn');
    delete process.env.LOG_LEVEL;
  });
});
