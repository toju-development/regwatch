/**
 * Fake Microsoft Entra ID Credentials provider for dev/CI sign-in.
 *
 * Spec: sdd/auth-ms-entra R-ENTRA-1 (conditional provider registration),
 *   R-ENTRA-4 (auto-org on first Entra sign-in).
 * Design: § Interfaces / Contracts — `fakeEntraCredentials()`.
 *
 * Mirrors `fake-google.ts` exactly. Mounted in `auth.ts` ONLY when
 * `env.AUTH_FAKE_ENTRA === 'true'` — the real `MicrosoftEntraId` provider
 * is used in production when the three Entra env vars are set.
 *
 * Because Credentials providers BYPASS the Auth.js adapter, `events.createUser`
 * does NOT fire for first-time sign-in via this provider. We therefore call
 * `createPersonalOrgForUser` directly from `authorize()` whenever we mint a
 * brand-new User row, preserving the auto-org-on-signup invariant (R-ENTRA-4).
 */
import Credentials from 'next-auth/providers/credentials';
import { prisma } from '@regwatch/db';
import { createPersonalOrgForUser } from '@/lib/auto-org';

export function fakeEntraProvider() {
  return Credentials({
    id: 'microsoft-entra-id-fake',
    name: 'Fake Microsoft Entra (dev/CI only)',
    credentials: {
      email: { label: 'Email', type: 'email' },
    },
    async authorize(
      credentials: Partial<Record<'email', unknown>>,
    ): Promise<{ id: string; email: string; name: string | null } | null> {
      const raw = credentials?.email;
      if (typeof raw !== 'string' || raw.length === 0) return null;
      const email = raw.toLowerCase();

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return { id: existing.id, email: existing.email, name: existing.name };
      }

      // First-ever sign-in for this email — preserve the auto-org invariant
      // even though events.createUser will NOT fire (Credentials bypasses the
      // adapter). createPersonalOrgForUser is idempotent: if the user already
      // has memberships from a prior partial run it short-circuits.
      const created = await prisma.user.create({
        data: { email, emailVerified: new Date() },
      });
      await createPersonalOrgForUser(prisma, {
        id: created.id,
        email: created.email,
        name: created.name,
      });
      return { id: created.id, email: created.email, name: created.name };
    },
  });
}
