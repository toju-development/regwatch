/**
 * Edge-safe NextAuth config slice.
 *
 * Spec: auth-foundation § auth (Google sign-in, Magic Link, sign-out).
 * Design §2 (R3): split into two files so future `middleware.ts` (MVP-3b)
 * can import the edge-safe slice WITHOUT pulling Prisma adapter or any
 * Node-only transport.
 *
 * Rules for THIS file:
 *   - NO `@auth/prisma-adapter` import
 *   - NO `@regwatch/db` import
 *   - NO `node:crypto`, `nodemailer`, `resend` (Node-only)
 *   - Only static provider config objects, `pages`, and stub callbacks
 *
 * Real adapter, jwt overrides, callbacks live in `auth.ts` (Node).
 */
import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';

export const authConfig: NextAuthConfig = {
  // Google provider object is edge-safe (pure config). Real Google secrets are
  // optional in dev/CI per operator decision #624 — empty strings are fine,
  // the provider just won't be invocable. The fake-google credentials provider
  // (mounted in auth.ts only when AUTH_FAKE_GOOGLE === '1') is the actual dev
  // sign-in path.
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? '',
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? '',
    }),
  ],
  pages: {
    signIn: '/login',
  },
  // Real callbacks live in auth.ts (Node). authorized() lives here so the
  // future edge middleware can use it.
  callbacks: {
    authorized({ auth }) {
      return Boolean(auth?.user);
    },
  },
};
