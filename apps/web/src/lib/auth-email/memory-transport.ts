/**
 * In-memory email transport for Magic Link sign-in.
 *
 * Spec: auth-foundation § auth — Magic Link Sign-in (R "Request → click → accept").
 * Design §6 (Q11). Operator decision #624: dev/CI uses memory ONLY for MVP-3a;
 * real Resend lands in a future deploy slice.
 *
 * Module-scoped Map<email, MagicLinkRecord[]> survives in-process across
 * sign-in attempts. Cleared on process restart (which is fine for tests and
 * local dev).
 *
 * `readInbox()` is consumed by the double-guarded `/api/_test/inbox/[email]`
 * test endpoint; production paths NEVER call it.
 */
import type { EmailConfig } from 'next-auth/providers/email';

export interface MagicLinkRecord {
  url: string;
  receivedAt: Date;
}

const inbox = new Map<string, MagicLinkRecord[]>();

function key(email: string): string {
  return email.toLowerCase();
}

export function readInbox(email: string): MagicLinkRecord[] {
  return inbox.get(key(email)) ?? [];
}

export function clearInbox(): void {
  inbox.clear();
}

/**
 * Build the in-memory email provider config object.
 *
 * IMPORTANT: `id` is set to `'resend'` (not `'memory'`) on purpose — this
 * keeps the UI invariant: `signIn('resend', { email })` works regardless of
 * whether the runtime transport is real Resend or this in-memory stub.
 * The Auth.js adapter still creates and consumes `VerificationToken` rows
 * because `type: 'email'` drives the standard email-provider machinery.
 */
export function memoryEmailProvider(): EmailConfig {
  return {
    id: 'resend',
    type: 'email',
    name: 'Memory (test)',
    from: 'test@regwatch.local',
    maxAge: 60 * 60 * 24, // 24h — Auth.js default; preserved (R7).
    server: {},
    options: {},
    async sendVerificationRequest({
      identifier,
      url,
    }: {
      identifier: string;
      url: string;
    }): Promise<void> {
      const k = key(identifier);
      const arr = inbox.get(k) ?? [];
      arr.push({ url, receivedAt: new Date() });
      inbox.set(k, arr);
    },
  } as EmailConfig;
}
