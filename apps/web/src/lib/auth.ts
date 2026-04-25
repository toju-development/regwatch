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
import { MEMBERSHIPS_CLAIM_CAP, type MembershipClaim, type Role } from '@regwatch/types';

import { env } from '@/env';
import { authConfig } from '@/lib/auth.config';
import { memoryEmailProvider } from '@/lib/auth-email/memory-transport';
import { fakeGoogleProvider } from '@/lib/auth-providers/fake-google';
import { createPersonalOrgForUser } from '@/lib/auto-org';

const JWT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30d (Auth.js default)
const ISSUER_DEFAULT = 'regwatch-web';
const AUDIENCE_DEFAULT = 'regwatch-api';

function secretToString(secret: string | string[]): string {
  return Array.isArray(secret) ? secret[0]! : secret;
}

async function fetchMemberships(userId: string): Promise<MembershipClaim[]> {
  const rows = await prisma.membership.findMany({
    where: { userId },
    take: MEMBERSHIPS_CLAIM_CAP,
    select: {
      organizationId: true,
      role: true,
      organization: { select: { slug: true } },
    },
  });
  if (rows.length === MEMBERSHIPS_CLAIM_CAP) {
    // Capped — JWT size invariant. Membership-mutating endpoints land in MVP-3b.
    console.warn(
      `[auth] memberships truncated at MEMBERSHIPS_CLAIM_CAP=${MEMBERSHIPS_CLAIM_CAP} for userId=${userId}`,
    );
  }
  return rows.map(
    (r: { organizationId: string; role: string; organization: { slug: string } }) => ({
      organizationId: r.organizationId,
      orgSlug: r.organization.slug,
      role: r.role as Role,
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma) as ReturnType<typeof PrismaAdapter>,
  secret: env.AUTH_SECRET,
  session: { strategy: 'jwt', maxAge: JWT_MAX_AGE_SECONDS },
  providers: [
    ...authConfig.providers,
    memoryEmailProvider(),
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
          (token as Record<string, unknown>).memberships = await fetchMemberships(userId);
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
