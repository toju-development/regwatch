/**
 * NextAuth v5 wiring (Node-only) for `apps/web`.
 *
 * Spec: auth-foundation § auth (R "Google OAuth Sign-in", "Magic Link Sign-in",
 *   "Auto-Org-on-Signup Invariant", "JWT Issuance Shape", "Sign-out Clears Web Session").
 * Design §2, §3, §4, §5, §6.
 *
 * Composition: extends edge-safe `authConfig` from `./auth.config.ts` with
 *   - PrismaAdapter (Node-only)
 *   - Provider list (real Google + memory-email + optional fake-google)
 *   - JWT strategy + HS256 JWS encode/decode override (R-Sign)
 *   - jwt/session callbacks populating MembershipClaim[]
 *   - events.createUser → createPersonalOrgForUser (auto-org invariant)
 *
 * R-Sign rationale: Auth.js v5 default token format is JWE A256CBC-HS512.
 * `apps/api` validates with `jose.jwtVerify` which expects plain JWS. We
 * override `jwt.encode/decode` to produce/consume HS256 JWS using the same
 * shared `AUTH_SECRET`. THIS IS THE ONE PLACE we deviate from Auth.js
 * defaults — keep this comment in sync if the override moves or changes.
 */
import 'server-only';

import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import * as jose from 'jose';
import { prisma, Prisma } from '@regwatch/db';
import { type MembershipClaim } from '@regwatch/types';

import { env } from '@/env';
import { authConfig } from '@/lib/auth.config';
import { memoryEmailProvider } from '@/lib/auth-email/memory-transport';
import { fakeGoogleProvider } from '@/lib/auth-providers/fake-google';
import { fetchMemberships, fetchMembershipsVersion } from '@/lib/auth-memberships';
import { createPersonalOrgForUser } from '@/lib/auto-org';
import { clearActiveOrgOnSignOut } from '@/lib/auth-signout';

/**
 * Resolve the email provider implementation from `EMAIL_TRANSPORT`.
 *
 * - `'memory'` → in-process magic-link inbox (dev/CI). Per operator decision
 *   #624 this is the default through MVP-3a.
 * - `'resend'` → real Resend transport. Deferred to MVP-3b deploy slice;
 *   selecting it before then is a fail-fast configuration error (Q4 lock:
 *   no silent fallbacks). Required env: AUTH_RESEND_KEY + AUTH_EMAIL_FROM.
 *
 * Throws at module-load time so a misconfigured deploy never boots.
 */
function resolveEmailProvider(): ReturnType<typeof memoryEmailProvider> {
  // Build-time bypass (foot-gun #6): when SKIP_ENV_VALIDATION=1, t3-env
  // skips Zod parsing AND its defaults — so `env.EMAIL_TRANSPORT` is
  // undefined here even though the schema default is 'memory'. Next.js 15
  // evaluates this module during `next build` page-data collection, where
  // we deliberately don't bind real secrets. Return the memory provider
  // as a safe no-op; actual runtime always has env validated.
  if (process.env.SKIP_ENV_VALIDATION === '1' || env.EMAIL_TRANSPORT === 'memory') {
    return memoryEmailProvider();
  }
  // env.EMAIL_TRANSPORT === 'resend'
  if (!env.AUTH_RESEND_KEY || !env.AUTH_EMAIL_FROM) {
    throw new Error(
      'EMAIL_TRANSPORT=resend requires AUTH_RESEND_KEY and AUTH_EMAIL_FROM. ' +
        'Set both, or use EMAIL_TRANSPORT=memory in dev/CI.',
    );
  }
  throw new Error(
    'EMAIL_TRANSPORT=resend selected but Resend provider not yet implemented ' +
      '(deferred to MVP-3b deploy slice). Use EMAIL_TRANSPORT=memory in dev/CI.',
  );
}

const JWT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30d (Auth.js default)
const ISSUER_DEFAULT = 'regwatch-web';
const AUDIENCE_DEFAULT = 'regwatch-api';

function secretToString(secret: string | string[]): string {
  return Array.isArray(secret) ? secret[0]! : secret;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma) as ReturnType<typeof PrismaAdapter>,
  secret: env.AUTH_SECRET,
  session: { strategy: 'jwt', maxAge: JWT_MAX_AGE_SECONDS },
  providers: [
    ...authConfig.providers,
    resolveEmailProvider(),
    ...(env.AUTH_FAKE_GOOGLE ? [fakeGoogleProvider()] : []),
  ],

  // R-Sign: HS256 JWS override — see file header.
  jwt: {
    maxAge: JWT_MAX_AGE_SECONDS,
    async encode({ token, secret, maxAge }) {
      const key = new TextEncoder().encode(secretToString(secret));
      const ttl = maxAge ?? JWT_MAX_AGE_SECONDS;
      const payload = { ...(token ?? {}) } as jose.JWTPayload;
      // Strip Auth.js-internal `picture` etc. but KEEP all our custom claims
      // (sub, userId, email, memberships).
      return await new jose.SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuedAt()
        .setIssuer(env.JWT_ISSUER ?? ISSUER_DEFAULT)
        .setAudience(env.JWT_AUDIENCE ?? AUDIENCE_DEFAULT)
        .setExpirationTime(`${ttl}s`)
        .sign(key);
    },
    async decode({ token, secret }) {
      if (!token) return null;
      try {
        const key = new TextEncoder().encode(secretToString(secret));
        const { payload } = await jose.jwtVerify(token, key, {
          algorithms: ['HS256'],
          issuer: env.JWT_ISSUER ?? ISSUER_DEFAULT,
          audience: env.JWT_AUDIENCE ?? AUDIENCE_DEFAULT,
        });
        return payload as never;
      } catch {
        // Bad sig / expired / iss-aud mismatch → unauthenticated, not an error.
        return null;
      }
    },
  },

  events: {
    async createUser({ user }) {
      // Adapter just inserted a fresh User row (Google OAuth or Magic Link).
      // Auto-org invariant: every signed-in user MUST have ≥1 Membership.
      if (!user.id) return;
      await createPersonalOrgForUser(prisma, {
        id: user.id,
        email: user.email ?? '',
        name: user.name ?? null,
      });
    },
    // R-ActiveOrgCookie scenario "Sign-out clears cookie": the active-org
    // cookie must die in the same response as the NextAuth session cookie.
    // Handler is extracted to `auth-signout.ts` for unit testability — see
    // its module docstring.
    signOut: clearActiveOrgOnSignOut,
  },

  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger }) {
      // `user` is present on initial sign-in (any provider). `trigger==='update'`
      // fires when client calls update() — we re-fetch memberships so claim
      // freshness propagates without forcing a sign-out (entry point for
      // MVP-3b membership-mutating endpoints).
      const isInitial = Boolean(user) || trigger === 'signIn';
      const isUpdate = trigger === 'update';

      if (isInitial || isUpdate) {
        const userId = (user?.id ?? token.sub) as string | undefined;
        if (userId) {
          token.sub = userId;
          (token as Record<string, unknown>).userId = userId;
          if (user?.email) token.email = user.email;
          (token as Record<string, unknown>).memberships = await fetchMemberships(prisma, userId);
          // R-Jwt-Invalidate-Cross-User (sdd/org-members B1) — embed the
          // user's current `User.membershipsVersion`. Re-fetched on every
          // `update({})` trigger so a server-side membership mutation that
          // bumps the version is reflected on the next decoded JWT.
          (token as Record<string, unknown>).mv = await fetchMembershipsVersion(prisma, userId);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const userId = (token.sub ?? '') as string;
        const memberships = ((token as Record<string, unknown>).memberships ??
          []) as MembershipClaim[];
        // Augment the session for RSC consumers. `id` is the canonical NextAuth
        // session.user field; we mirror to userId for ergonomic parity with AuthUser.
        const u = session.user as unknown as Record<string, unknown>;
        u.id = userId;
        u.userId = userId;
        u.memberships = memberships;
      }
      return session;
    },
  },
});

// Re-export Prisma namespace under a stable alias so adjacent helpers can
// import a single error-typing surface from this module if convenient.
export { Prisma };
