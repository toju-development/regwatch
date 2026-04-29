import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailListener } from '../email.listener.js';
import type { EmailMessage, EmailPort } from '../email.port.js';
import type { InvitationCreatedEvent } from '../events/invitation-created.event.js';

/**
 * `EmailListener` unit tests (B2.8).
 *
 * Spec: `sdd/org-invitations/spec` R-Email-Port-Hexagonal:
 *   - "Email port called on issue" — handler invokes `EmailPort.send` once.
 *   - "Email send failure does NOT roll back" — handler swallows errors.
 * Design: `sdd/org-invitations/design` D3 (post-commit fire-and-forget),
 *   D4 (port shape).
 */

function makePort(): EmailPort & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(async () => {}) } as never;
}

const baseEvent: InvitationCreatedEvent = {
  to: 'invitee@test.local',
  orgName: 'Acme',
  inviterName: 'Alice',
  role: 'ADMIN',
  acceptUrl: 'https://app.regwatch.test/accept/tok-123',
  expiresAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('EmailListener.handle', () => {
  let port: ReturnType<typeof makePort>;
  let listener: EmailListener;

  beforeEach(() => {
    port = makePort();
    listener = new EmailListener(port);
  });

  it('builds an EmailMessage from the event and calls EmailPort.send exactly once', async () => {
    await listener.handle(baseEvent);

    expect(port.send).toHaveBeenCalledTimes(1);
    const sent = port.send.mock.calls[0]?.[0] as EmailMessage;
    expect(sent.to).toBe('invitee@test.local');
    expect(sent.subject).toBe('Alice invited you to Acme on RegWatch');
    expect(sent.text).toContain('https://app.regwatch.test/accept/tok-123');
    expect(sent.text).toContain('2026-01-01T00:00:00.000Z');
    expect(sent.html).toContain('<a href="https://app.regwatch.test/accept/tok-123">');
    expect(sent.html).toContain('<strong>Acme</strong>');
    expect(sent.html).toContain('<strong>ADMIN</strong>');
    expect(sent.tags).toEqual({ kind: 'invitation', role: 'ADMIN' });
  });

  it('falls back to "A teammate" when inviterName is null and HTML-escapes org name', async () => {
    await listener.handle({
      ...baseEvent,
      inviterName: null,
      orgName: 'Acme <script>alert(1)</script>',
    });

    const sent = port.send.mock.calls[0]?.[0] as EmailMessage;
    expect(sent.subject).toBe(
      'A teammate invited you to Acme <script>alert(1)</script> on RegWatch',
    );
    // Plain-text body keeps the raw chars; HTML body MUST escape them.
    expect(sent.html).toContain('Acme &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(sent.html).not.toContain('<script>alert(1)</script>');
  });

  it('swallows EmailPort.send errors (POST-commit fire-and-forget — no re-throw)', async () => {
    port.send.mockRejectedValueOnce(new Error('resend down'));

    await expect(listener.handle(baseEvent)).resolves.toBeUndefined();
    expect(port.send).toHaveBeenCalledTimes(1);
  });
});
