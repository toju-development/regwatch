/**
 * EmailPort — hexagonal port for outbound transactional email.
 *
 * Spec: `sdd/org-invitations/spec` R-Email-Port-Hexagonal.
 * Design: `sdd/org-invitations/design` D4 (port shape, EMAIL_PORT symbol),
 *   D3 (post-commit listener consumer).
 *
 * The MVP-3b3b adapter is `MemoryEmailAdapter` (in-process). The Resend
 * swap (deferred — engram `regwatch/pending/resend-swap` #694) only needs
 * a new class implementing this interface and a one-line provider rebind
 * in `EmailModule`. No service edits required.
 *
 * Foot-gun #667 (tsx + NestJS DI no decorator metadata): every consumer
 * MUST inject this port via `@Inject(EMAIL_PORT)` (symbol token), never
 * by interface type.
 */
export interface EmailMessage {
  /** RFC 5322 mailbox of the recipient. Lowercased by upstream callers. */
  to: string;
  /** Subject line (UTF-8). */
  subject: string;
  /** HTML body (UTF-8). */
  html: string;
  /** Plain-text body (UTF-8). */
  text: string;
  /** Optional adapter-specific tags (Resend tags, observability labels). */
  tags?: Record<string, string>;
}

export interface EmailPort {
  /**
   * Dispatch one message to the configured transport.
   *
   * Resolves on successful enqueue/send. Rejects on transport failure —
   * callers in this slice (`EmailListener`) catch and log, never re-throw,
   * because the originating DB transaction has already committed
   * (POST-commit fire-and-forget per design D3).
   */
  send(email: EmailMessage): Promise<void>;
}

/**
 * DI token for {@link EmailPort}. `Symbol`-based by foot-gun #667.
 */
export const EMAIL_PORT = Symbol('EMAIL_PORT');
