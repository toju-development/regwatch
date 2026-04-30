/**
 * `isSignInAllowed()` unit tests — pure helper, fake Prisma.
 *
 * Spec: `sdd/scanner-vertical-ar/spec` R-15-RegistrationGate scenarios:
 *   S1 "Existing OWNER passes even when registration disabled" → returning
 *      Membership user is never blocked (INV-AUTH-1 lockout-safe).
 *   S2 "Unknown email blocked when registration disabled" → no allowlist,
 *      no membership, no invitation → false.
 *   S3 "Allowlisted email passes when registration disabled" → env Set hit.
 *   S4 "REGISTRATION_ENABLED=true short-circuits" → never touches DB.
 *   S5 "Pending invitation passes" → mid-onboarding accept flow works.
 *
 * Design: ADR-13 — env-flag + allowlist. Helper is intentionally pure
 * (`(rawEmail, deps) → boolean`) so each branch is exercised with a tiny
 * fake-Prisma object — no NextAuth runtime, no DB, no module mocks.
 *
 * ## Why fake Prisma instead of real DB
 *
 * The `auth-memberships.spec.ts` neighbour uses real Postgres because it
 * exercises real Prisma projections that must match what NextAuth lands
 * in the JWT. THIS file exercises decision logic — a fake satisfies the
 * `Pick<PrismaClient, 'user' | 'invitation'>` shape and runs in <1ms.
 */
import { describe, expect, it, vi } from 'vitest';

import { isSignInAllowed, type RegistrationGateDeps } from '../auth-registration-gate.js';

interface FakeUserHit {
  memberships: Array<{ id: string }>;
}
interface FakeInvitationHit {
  id: string;
}

function buildDeps(opts: {
  registrationEnabled?: boolean;
  invited?: string[];
  userByEmail?: Record<string, FakeUserHit | null>;
  invitationByEmail?: Record<string, FakeInvitationHit | null>;
}): {
  deps: RegistrationGateDeps;
  userFindUnique: ReturnType<typeof vi.fn>;
  invitationFindFirst: ReturnType<typeof vi.fn>;
} {
  const userByEmail = opts.userByEmail ?? {};
  const invitationByEmail = opts.invitationByEmail ?? {};

  const userFindUnique = vi.fn(async (args: { where: { email: string } }) => {
    return userByEmail[args.where.email] ?? null;
  });
  const invitationFindFirst = vi.fn(
    async (args: { where: { email: string; acceptedAt: null; revokedAt: null } }) => {
      return invitationByEmail[args.where.email] ?? null;
    },
  );

  const deps: RegistrationGateDeps = {
    env: {
      REGISTRATION_ENABLED: opts.registrationEnabled ?? false,
      INVITED_EMAILS: new Set(opts.invited ?? []),
    },
    // Fake satisfies the `Pick<PrismaClient, 'user' | 'invitation'>` shape;
    // we only call `findUnique` / `findFirst` from the helper.
    prisma: {
      user: { findUnique: userFindUnique },
      invitation: { findFirst: invitationFindFirst },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };

  return { deps, userFindUnique, invitationFindFirst };
}

describe('isSignInAllowed — R-15-RegistrationGate', () => {
  it('S4 — returns true and skips DB when REGISTRATION_ENABLED=true', async () => {
    const { deps, userFindUnique, invitationFindFirst } = buildDeps({
      registrationEnabled: true,
    });

    await expect(isSignInAllowed('anyone@example.com', deps)).resolves.toBe(true);

    // Fast path must NEVER hit the DB.
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(invitationFindFirst).not.toHaveBeenCalled();
  });

  it('S3 — allowlisted email passes when registration disabled', async () => {
    const { deps, userFindUnique, invitationFindFirst } = buildDeps({
      invited: ['ops@regwatch.test'],
    });

    await expect(isSignInAllowed('ops@regwatch.test', deps)).resolves.toBe(true);

    // Allowlist hit must NEVER hit the DB either.
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(invitationFindFirst).not.toHaveBeenCalled();
  });

  it('S3.casing — allowlist match is case-insensitive', async () => {
    const { deps } = buildDeps({ invited: ['ops@regwatch.test'] });
    await expect(isSignInAllowed('OPS@RegWatch.Test', deps)).resolves.toBe(true);
  });

  it('S1 — existing user with ≥1 Membership passes (INV-AUTH-1 lockout-safe)', async () => {
    const { deps, invitationFindFirst } = buildDeps({
      userByEmail: { 'owner@acme.test': { memberships: [{ id: 'm_1' }] } },
    });

    await expect(isSignInAllowed('owner@acme.test', deps)).resolves.toBe(true);

    // Membership found → invitation lookup is short-circuited.
    expect(invitationFindFirst).not.toHaveBeenCalled();
  });

  it('S5 — pending invitation passes', async () => {
    const { deps, invitationFindFirst } = buildDeps({
      // User row exists but no memberships (e.g. invited but not accepted).
      userByEmail: { 'invitee@acme.test': { memberships: [] } },
      invitationByEmail: { 'invitee@acme.test': { id: 'inv_1' } },
    });

    await expect(isSignInAllowed('invitee@acme.test', deps)).resolves.toBe(true);

    // Confirm we filtered for live invitations only (acceptedAt + revokedAt = null).
    expect(invitationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: 'invitee@acme.test',
          acceptedAt: null,
          revokedAt: null,
        }),
      }),
    );
  });

  it('S5.no-user-row — pending invitation passes even when User row is absent', async () => {
    // Magic-link flow: the invitee row may not exist yet on first sign-in.
    const { deps } = buildDeps({
      invitationByEmail: { 'fresh@acme.test': { id: 'inv_2' } },
    });

    await expect(isSignInAllowed('fresh@acme.test', deps)).resolves.toBe(true);
  });

  it('S2 — unknown email blocked when registration disabled', async () => {
    const { deps } = buildDeps({});
    await expect(isSignInAllowed('stranger@example.com', deps)).resolves.toBe(false);
  });

  it('blocks empty / whitespace / missing email regardless of allowlist', async () => {
    const { deps, userFindUnique } = buildDeps({ invited: ['ops@regwatch.test'] });

    await expect(isSignInAllowed(null, deps)).resolves.toBe(false);
    await expect(isSignInAllowed(undefined, deps)).resolves.toBe(false);
    await expect(isSignInAllowed('', deps)).resolves.toBe(false);
    await expect(isSignInAllowed('   ', deps)).resolves.toBe(false);

    // Defensive guard runs BEFORE any DB lookup.
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it('lowercases incoming email before DB lookup', async () => {
    const { deps, userFindUnique } = buildDeps({
      userByEmail: { 'mixed@case.test': { memberships: [{ id: 'm_2' }] } },
    });

    await expect(isSignInAllowed('  Mixed@Case.Test  ', deps)).resolves.toBe(true);
    expect(userFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'mixed@case.test' } }),
    );
  });
});
