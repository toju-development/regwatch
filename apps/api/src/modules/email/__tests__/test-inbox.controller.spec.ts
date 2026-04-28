import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { MemoryEmailAdapter } from '../memory-email.adapter.js';
import { TestInboxController } from '../test-inbox.controller.js';

/**
 * `TestInboxController` unit tests (B2.9).
 *
 * Spec: `sdd/org-invitations/spec` R-Email-Port-Hexagonal (E2E inbox API).
 * Design: `sdd/org-invitations/design` D13 — handler-level guard returns
 *   404 (NOT 403, no info leak) when env predicate fails.
 *
 * The module-level mount predicate is exercised by E2E setup; here we
 * pin the handler-level `assertEnabled` re-check.
 */

describe('TestInboxController', () => {
  let originalNodeEnv: string | undefined;
  let originalTransport: string | undefined;
  let adapter: MemoryEmailAdapter;
  let controller: TestInboxController;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    originalTransport = process.env.EMAIL_TRANSPORT;
    adapter = new MemoryEmailAdapter();
    controller = new TestInboxController(adapter);
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalTransport === undefined) delete process.env.EMAIL_TRANSPORT;
    else process.env.EMAIL_TRANSPORT = originalTransport;
  });

  it('GET / returns the inbox snapshot when NODE_ENV=test and EMAIL_TRANSPORT=memory', async () => {
    process.env.NODE_ENV = 'test';
    process.env.EMAIL_TRANSPORT = 'memory';
    await adapter.send({ to: 'a@test.local', subject: 's', html: '<p/>', text: 't' });

    const result = controller.list();
    expect(result).toHaveLength(1);
    expect(result[0]?.to).toBe('a@test.local');
  });

  it('POST /clear empties the inbox when guard passes', async () => {
    process.env.NODE_ENV = 'development';
    process.env.EMAIL_TRANSPORT = 'memory';
    await adapter.send({ to: 'a@test.local', subject: 's', html: '<p/>', text: 't' });

    expect(() => controller.clear()).not.toThrow();
    expect(adapter.getSent()).toEqual([]);
  });

  it('throws NotFoundException (NOT Forbidden — D13 no info leak) when NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';
    process.env.EMAIL_TRANSPORT = 'memory';

    expect(() => controller.list()).toThrow(NotFoundException);
    expect(() => controller.clear()).toThrow(NotFoundException);
  });

  it('throws NotFoundException when EMAIL_TRANSPORT !== "memory"', () => {
    process.env.NODE_ENV = 'test';
    process.env.EMAIL_TRANSPORT = 'resend';

    expect(() => controller.list()).toThrow(NotFoundException);
    expect(() => controller.clear()).toThrow(NotFoundException);
  });
});
