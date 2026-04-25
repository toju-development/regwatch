/**
 * In-memory email transport for Magic Link sign-in.
 *
 * Spec: auth-foundation § auth — Magic Link Sign-in (R "Request → click → accept").
 * Design §6 (Q11). Operator decision #624: dev/CI uses memory ONLY for MVP-3a;
 * real Resend lands in a future deploy slice.
 *
 * The inbox lives on `globalThis` (NOT module scope) on purpose: in Next.js
 * dev, Server Actions and Route Handlers compile into SEPARATE module graphs.
 * A plain module-scoped Map would yield TWO inbox instances — sendVerification
 * writes to one, /api/test/inbox reads from the other → Playwright sees empty.
 * `globalThis` is shared across all graphs in the same Node process.
 *
 * `readInbox()` is consumed by the double-guarded `/api/test/inbox/[email]`
 * test endpoint; production paths NEVER call it.
 */
import type { EmailConfig } from 'next-auth/providers/email';

export interface MagicLinkRecord {
  url: string;
  receivedAt: Date;
}

const INBOX_KEY = '__regwatch_memory_inbox__';

interface InboxGlobal {
  [INBOX_KEY]?: Map<string, MagicLinkRecord[]>;
}

function getInbox(): Map<string, MagicLinkRecord[]> {
  const g = globalThis as unknown as InboxGlobal;
  if (!g[INBOX_KEY]) g[INBOX_KEY] = new Map<string, MagicLinkRecord[]>();
  return g[INBOX_KEY];
}

function key(email: string): string {
  return email.toLowerCase();
}

export function readInbox(email: string): MagicLinkRecord[] {
  return getInbox().get(key(email)) ?? [];
}

export function clearInbox(): void {
  getInbox().clear();
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
      const inbox = getInbox();
      const arr = inbox.get(k) ?? [];
      arr.push({ url, receivedAt: new Date() });
      inbox.set(k, arr);
    },
  } as EmailConfig;
}
