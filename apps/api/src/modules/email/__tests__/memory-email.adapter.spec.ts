import 'reflect-metadata';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryEmailAdapter } from '../memory-email.adapter.js';
import type { EmailMessage } from '../email.port.js';

/**
 * `MemoryEmailAdapter` unit tests (B2.7).
 *
 * Spec: `sdd/org-invitations/spec` R-Email-Port-Hexagonal scenarios
 *   "Email port called on issue" + the test-inbox query API.
 * Design: `sdd/org-invitations/design` D4 — flat-array storage, four
 *   methods (`send`/`getSent`/`getLast`/`clear`).
 */

function msg(over: Partial<EmailMessage> = {}): EmailMessage {
  return {
    to: 'invitee@test.local',
    subject: 'You are invited',
    html: '<p>hi</p>',
    text: 'hi',
    ...over,
  };
}

describe('MemoryEmailAdapter', () => {
  let adapter: MemoryEmailAdapter;

  beforeEach(() => {
    adapter = new MemoryEmailAdapter();
  });

  it('send appends the message to the inbox in insertion order', async () => {
    await adapter.send(msg({ subject: 'one' }));
    await adapter.send(msg({ subject: 'two' }));
    await adapter.send(msg({ subject: 'three' }));

    expect(adapter.getSent().map((m) => m.subject)).toEqual(['one', 'two', 'three']);
  });

  it('getSent returns a defensive shallow copy (mutating result does not affect inbox)', async () => {
    await adapter.send(msg({ subject: 'one' }));
    const snapshot = adapter.getSent();
    snapshot.push(msg({ subject: 'injected' }));
    snapshot.length = 0;

    expect(adapter.getSent().map((m) => m.subject)).toEqual(['one']);
  });

  it('getLast returns the most recently sent message, or undefined when empty', async () => {
    expect(adapter.getLast()).toBeUndefined();
    await adapter.send(msg({ subject: 'first' }));
    await adapter.send(msg({ subject: 'second' }));
    expect(adapter.getLast()?.subject).toBe('second');
  });

  it('clear empties the inbox', async () => {
    await adapter.send(msg());
    await adapter.send(msg());
    expect(adapter.getSent()).toHaveLength(2);
    adapter.clear();
    expect(adapter.getSent()).toEqual([]);
    expect(adapter.getLast()).toBeUndefined();
  });
});
