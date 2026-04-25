/**
 * Fake-google Credentials provider for dev/CI sign-in.
 *
 * Spec: auth-foundation § auth — Google OAuth Sign-in (runtime fixture in CI).
 * Design §6 (Q11). Operator decision #624: dev/CI uses fake-google ONLY for
 * MVP-3a; real Google client provisioning lands in a future deploy slice.
 *
 * Mounted in `auth.ts` ONLY when `env.AUTH_FAKE_GOOGLE === true` — otherwise
 * the real `Google({clientId, clientSecret})` from `auth.config.ts` is the
 * only Google sign-in path.
 *
 * Because Credentials providers BYPASS the Auth.js adapter, `events.createUser`
 * does NOT fire for first-time sign-in via this provider. We therefore call
 * `createPersonalOrgForUser` directly from `authorize()` whenever we mint a
 * brand-new User row, preserving the auto-org-on-signup invariant.
 */
import Credentials from 'next-auth/providers/credentials';
import { prisma } from '@regwatch/db';
import { createPersonalOrgForUser } from '@/lib/auto-org';

export function fakeGoogleProvider() {
  return Credentials({
    id: 'google-fake',
    name: 'Fake Google (dev/CI only)',
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
