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
  // create a second org. unique([userId, organizationId]) on Membership is
  // the DB-level safety net but this short-circuits before we even try.
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
      });
      return;
    } catch (err) {
      if (isOrgSlugUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new Error(`auto-org: slug exhaustion for user ${user.id} (base=${baseSlug})`);
}
