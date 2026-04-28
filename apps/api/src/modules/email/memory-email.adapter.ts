import { Injectable, Logger } from '@nestjs/common';
import type { EmailMessage, EmailPort } from './email.port.js';

/**
 * In-process {@link EmailPort} implementation backing the development /
 * E2E test inbox.
 *
 * Spec: `sdd/org-invitations/spec` R-Email-Port-Hexagonal scenarios.
 * Design: `sdd/org-invitations/design` D4 (memory adapter API), D13
 *   (`TestInboxController` reads from this adapter).
 *
 * Storage: a flat private array kept in insertion order — sufficient
 * for the orchestrator's revised D4 query API:
 *
 *   - {@link send}    — append to the inbox (also debug-logs).
 *   - {@link getSent} — snapshot of every message ever sent.
 *   - {@link getLast} — most recently sent message (or `undefined`).
 *   - {@link clear}   — reset between Playwright cases.
 *
 * Inbox is **NOT** thread-safe across processes; this adapter is a
 * single-process dev/test artifact only. The Resend swap (#694) will
 * replace this provider — no other code knows the storage shape.
 *
 * Foot-gun #667 (tsx + NestJS DI no decorator metadata): the consumer
 * `EmailListener` resolves us via `@Inject(EMAIL_PORT)`. The
 * `TestInboxController` injects the concrete class so it can call
 * `getSent()` / `clear()` (those are NOT on the port).
 */
@Injectable()
export class MemoryEmailAdapter implements EmailPort {
  private readonly logger = new Logger(MemoryEmailAdapter.name);
  private readonly inbox: EmailMessage[] = [];

  /**
   * Persist `email` into the in-memory inbox and emit a debug log line.
   *
   * Returns a resolved Promise — there is no failure path in the memory
   * adapter (the array push is synchronous). The Promise return type is
   * required by the {@link EmailPort} contract so future transports
   * (Resend, SMTP) are drop-in.
   */
  async send(email: EmailMessage): Promise<void> {
    this.inbox.push(email);
    this.logger.debug(
      `MemoryEmailAdapter.send to=${email.to} subject="${email.subject}" inbox=${this.inbox.length}`,
    );
  }

  /**
   * Snapshot of the entire inbox in insertion order.
   *
   * Returns a shallow copy so callers can mutate the result without
   * disturbing internal state.
   */
  getSent(): EmailMessage[] {
    return [...this.inbox];
  }

  /**
   * Most recently sent message, or `undefined` when the inbox is empty.
   */
  getLast(): EmailMessage | undefined {
    return this.inbox.length === 0 ? undefined : this.inbox[this.inbox.length - 1];
  }

  /**
   * Drop every message. Intended for Playwright `beforeEach` resets via
   * the dev-only `POST /test/email-inbox/clear` endpoint.
   */
  clear(): void {
    this.inbox.length = 0;
  }
}
