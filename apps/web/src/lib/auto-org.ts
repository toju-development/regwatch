/**
 * Auto-org-on-signup transaction.
 *
 * Spec: auth-foundation § auth — R "Auto-Org-on-Signup Invariant"
 *   - S "First-ever sign-in creates personal org"
 *   - S "Returning user does not duplicate"
 *
 * Design §5 (Q7). Mitigates R5 (slug-collision race) via:
 *   1. Idempotency pre-check (skip if user already has ≥1 Membership).
 *   2. Prisma `$transaction` so Org + Membership(OWNER) land atomically.
 *   3. Unique-constraint retry on `Organization_slug_key` collisions
 *      (up to 5 attempts, each appending a 4-hex random suffix).
 *
 * Per operator decision #624: HAND-ROLLED slug helper (no
 * @sindresorhus/slugify, no nanoid). ASCII-only is sufficient for personal
 * orgs — the slug is mostly ergonomic, not user-facing branding. Suffix
 * uses `node:crypto.randomBytes(2)` (≈65k entropy per attempt) which makes
 * 5 collisions ridiculously unlikely.
 */
import { randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '@regwatch/db';

type PrismaTx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const SLUG_MAX = 40;
const NAME_MAX = 120;
const MAX_ATTEMPTS = 5;
const ORG_SLUG_UNIQUE_CONSTRAINT = 'Organization_slug_key';
const USER_PERSONAL_ORG_ID_UNIQUE_CONSTRAINT = 'User_personalOrgId_key';

/**
 * Sentinel thrown by the loser tx to abort its own commit. NOT exported —
 * the public API of `createPersonalOrgForUser` MUST stay no-throw on race.
 *
 * Why a sentinel and not the bare P2002: the UNIQUE on `User.personalOrgId`
 * does NOT actually fire on concurrent first sign-ins — both txs update the
 * SAME user row, just with different org IDs, and UNIQUE constrains across
 * users not across values for one user. The race is closed by a conditional
 * `updateMany({where:{id, personalOrgId:null}})` inside the tx: the winner
 * sees count=1, the loser (after row-lock release) sees count=0 and throws
 * this sentinel to roll back its tentative org+membership cleanly. The
 * UNIQUE constraint stays as defense-in-depth (rejects manual data drift
 * where two users somehow end up pointing to the same personal org).
 *
 * Deviation note (B2 apply): design §3 originally relied on UNIQUE-on-
 * commit to fire P2002 against `User_personalOrgId_key`. That mechanism
 * does not actually trigger under PG READ COMMITTED for this access pattern
 * — confirmed empirically by the race test in this batch. Conditional
 * updateMany is the standard race-on-update fix and preserves all other
 * design contracts (single tx, no-throw to caller, idempotent re-entry).
 */
class PersonalOrgRaceLostError extends Error {
  constructor() {
    super('auto-org: lost race to set User.personalOrgId');
    this.name = 'PersonalOrgRaceLostError';
  }
}

/**
 * Hand-rolled ASCII slugifier. Lower-cases, strips diacritics, replaces
 * non-alphanumerics with `-`, trims edge dashes, caps at SLUG_MAX. Always
 * returns at least `'workspace'` (never empty — that would violate the
 * Organization.slug NOT NULL contract).
 */
export function slugifyForOrg(input: string): string {
  const cleaned = input
    .toLowerCase()
    .normalize('NFKD')
    // strip combining diacritical marks
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX);
  return cleaned.length > 0 ? cleaned : 'workspace';
}

function randomSuffix(): string {
  // 2 bytes → 4 hex chars (16-bit entropy per attempt). 5 retries
  // ≈ 1 in 10^18 odds of total exhaustion.
  return randomBytes(2).toString('hex');
}

export interface AutoOrgUser {
  id: string;
  email: string;
  name?: string | null;
}

export type PrismaLike = Pick<PrismaClient, 'membership' | 'organization' | '$transaction'>;

function isOrgSlugUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  // `meta.target` may be string | string[] depending on driver.
  const target = err.meta?.target;
  if (Array.isArray(target)) {
    return target.includes('slug') || target.includes(ORG_SLUG_UNIQUE_CONSTRAINT);
  }
  return target === ORG_SLUG_UNIQUE_CONSTRAINT || target === 'slug';
}

/**
 * Detects the DB-level race-loser signal: the loser's `tx.user.update` hit
 * the `User.personalOrgId` UNIQUE constraint because the winner already
 * committed first. The loser tx rolls back cleanly (its tentative org +
 * membership are dropped), so we just bail — the winner's rows are already
 * persisted; subsequent calls hit the top-of-fn `findFirst` short-circuit.
 *
 * Spec: `sdd/auth-authorization-guards/spec` § "Auto-Org-on-Signup
 * Invariant" → S "Concurrent first sign-in produces exactly one org".
 */
function isPersonalOrgIdUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const target = err.meta?.target;
  if (Array.isArray(target)) {
    return (
      target.includes('personalOrgId') || target.includes(USER_PERSONAL_ORG_ID_UNIQUE_CONSTRAINT)
    );
  }
  return target === USER_PERSONAL_ORG_ID_UNIQUE_CONSTRAINT || target === 'personalOrgId';
}

/**
 * Idempotently create a personal Organization + OWNER Membership for a User.
 *
 * Called from:
 *   - `events.createUser` — fires after the Auth.js adapter inserts a User
 *     row from Google OAuth or Magic Link sign-in.
 *   - `fakeGoogleProvider.authorize` — Credentials providers bypass the
 *     adapter, so we invoke this directly when we mint a User there.
 *
 * Throws only if all `MAX_ATTEMPTS` slug variants collide (essentially
 * impossible) or if a non-collision error escapes the transaction.
 */
export async function createPersonalOrgForUser(
  prisma: PrismaLike,
  user: AutoOrgUser,
): Promise<void> {
  // Idempotency guard — partial failures or events firing twice MUST NOT
  // create a second org. The DB-level safety net is `User.personalOrgId
  // @unique` (added MVP-3b1, see migration `add_user_personal_org_id`):
  // the winning tx sets `personalOrgId` inside the same transaction that
  // creates the Org + Membership. Concurrent losers fail at COMMIT with
  // P2002 on `User_personalOrgId_key` and are caught + treated as no-op.
  // See `regwatch/known-issues/auto-org-race` for full analysis.
  const existing = await prisma.membership.findFirst({
    where: { userId: user.id },
    select: { id: true },
  });
  if (existing) return;

  const baseSource = user.name?.trim().split(/\s+/)[0] ?? user.email.split('@')[0] ?? '';
  const baseSlug = slugifyForOrg(baseSource);
  const displayName = (
    user.name ? `${user.name}'s workspace` : `${user.email.split('@')[0]}'s workspace`
  ).slice(0, NAME_MAX);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug.slice(0, SLUG_MAX - 5)}-${randomSuffix()}`;
    try {
      await prisma.$transaction(async (tx: PrismaTx) => {
        const org = await tx.organization.create({
          data: { slug, name: displayName },
        });
        await tx.membership.create({
          data: { userId: user.id, organizationId: org.id, role: 'OWNER' },
        });
        // Race-safety: conditional UPDATE — only succeed if no concurrent
        // tx already bound this user. Under PG READ COMMITTED, the second
        // updateMany blocks on the row lock; once the winner commits,
        // the loser re-evaluates the WHERE and sees `personalOrgId` is no
        // longer null → count=0 → we abort, rolling back the tentative
        // org + membership. The UNIQUE on `personalOrgId` is kept as
        // defense-in-depth (see PersonalOrgRaceLostError docstring).
        const updated = await tx.user.updateMany({
          where: { id: user.id, personalOrgId: null },
          data: { personalOrgId: org.id },
        });
        if (updated.count === 0) {
          throw new PersonalOrgRaceLostError();
        }
      });
      return;
    } catch (err) {
      if (isOrgSlugUniqueViolation(err)) continue;
      if (err instanceof PersonalOrgRaceLostError) {
        // Race lost: the winner already committed an org + membership +
        // personalOrgId for this user. Tx rolled back — nothing to clean
        // up. Idempotent return is the contract (no-throw to caller).
        return;
      }
      if (isPersonalOrgIdUniqueViolation(err)) {
        // Defense-in-depth: kept for the (unlikely) drift scenario where
        // a UNIQUE conflict still surfaces (e.g. recovered partial state
        // or a future code path that bypasses the conditional update).
        return;
      }
      throw err;
    }
  }
  throw new Error(`auto-org: slug exhaustion for user ${user.id} (base=${baseSlug})`);
}
