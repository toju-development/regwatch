/**
 * Shared auth DTOs for `apps/web` (issuer) and `apps/api` (verifier).
 *
 * Spec: `sdd/auth-foundation/spec` — capability `auth`, R "JWT Issuance Shape".
 * Design: `sdd/auth-foundation/design` §3 (JWT contract).
 *
 * Type-only — no runtime validation here. `apps/api` runtime-narrows JWT
 * payloads to `JwtClaims` via zod inside `jwt-verifier.ts`.
 */

/**
 * Membership role.
 *
 * Mirrors `Role` from `@regwatch/db` (Prisma-generated enum from
 * `packages/db/prisma/schema.prisma`). Mirrored as a literal union here to
 * keep `@regwatch/types` a leaf package (no dep on `@regwatch/db`, avoids a
 * cycle if `db` ever needs to consume shared types).
 *
 * Authorization matrix lives in `sdd-init/regwatch` (#585).
 *
 * INVARIANT: this union MUST stay in sync with the Prisma `Role` enum. If
 * Prisma adds/removes a role, update this file.
 */
export type Role = 'OWNER' | 'ADMIN' | 'ANALYST' | 'VIEWER';

/**
 * One membership entry as it appears inside a JWT `memberships[]` claim.
 *
 * `orgSlug` is duplicated from `Organization.slug` so the API/Web can render
 * org-scoped URLs without an extra DB hit per request.
 */
export interface MembershipClaim {
  organizationId: string;
  orgSlug: string;
  role: Role;
}

/**
 * Hard cap for the `memberships[]` claim inside a JWT.
 *
 * Per design §3 / Q6.3: tokens with > {@link MEMBERSHIPS_CLAIM_CAP} memberships
 * MUST be truncated by the issuer (with a warn log) to keep JWT size bounded.
 */
export const MEMBERSHIPS_CLAIM_CAP = 50;

/**
 * Canonical RegWatch JWT payload.
 *
 * Signed by `apps/web` (NextAuth `jwt.encode` override → HS256 JWS) and
 * verified by `apps/api` (`jose.jwtVerify` with shared `AUTH_SECRET`).
 *
 * `sub` and `userId` carry the same value — `sub` is the Auth.js / RFC 7519
 * standard subject claim; `userId` is duplicated for ergonomic consumer code
 * that wants an explicit field.
 */
export interface JwtClaims {
  /** Subject — equals {@link userId}. RFC 7519 standard claim. */
  sub: string;
  /** Application user id (mirrors {@link sub}). */
  userId: string;
  /** Verified email at sign-in time. */
  email: string;
  /** Capped at {@link MEMBERSHIPS_CLAIM_CAP}. */
  memberships: MembershipClaim[];
  /** Issued-at (epoch seconds). RFC 7519 standard claim. */
  iat: number;
  /** Expiration (epoch seconds). RFC 7519 standard claim. */
  exp: number;
  /** Optional issuer — set when `JWT_ISSUER` env var is present. */
  iss?: string;
  /** Optional audience — set when `JWT_AUDIENCE` env var is present. */
  aud?: string;
}

/**
 * Authenticated principal as exposed by `apps/api` via the `@CurrentUser()`
 * param decorator. Strips JWT-machinery fields (`iat`, `exp`, `iss`, `aud`,
 * `sub`) — controllers should not depend on token plumbing.
 */
export interface AuthUser {
  userId: string;
  email: string;
  memberships: MembershipClaim[];
}
