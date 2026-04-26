import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@regwatch/db';
import { createPersonalOrgForUser, type PrismaLike, slugifyForOrg } from '../auto-org.js';

/**
 * Spec: `sdd/auth-foundation/spec` § auth — R "Auto-Org-on-Signup Invariant".
 *
 * Tests use plain `PrismaLike` stubs (Pick<PrismaClient, 'membership' |
 * 'organization' | '$transaction'>) — no need to mock the whole client.
 * Slug-collision retry is exercised with a real
 * `Prisma.PrismaClientKnownRequestError(P2002, target=['slug'])` so the
 * `instanceof` check inside `isOrgSlugUniqueViolation` is genuinely tested.
 */

interface CallCounts {
  findFirst: number;
  txOpen: number;
  orgCreate: number;
  membershipCreate: number;
  userUpdate: number;
}

interface StubOpts {
  existingMembership?: { id: string } | null;
  /** Slug values that should trigger a P2002 collision before succeeding. */
  collideSlugs?: ReadonlySet<string>;
  /** Force every attempt to collide → exhaustion. */
  alwaysCollide?: boolean;
}

function makePrismaStub(opts: StubOpts = {}): {
  prisma: PrismaLike;
  counts: CallCounts;
  lastSlug: () => string | undefined;
} {
  const counts: CallCounts = {
    findFirst: 0,
    txOpen: 0,
    orgCreate: 0,
    membershipCreate: 0,
    userUpdate: 0,
  };
  let lastSlug: string | undefined;

  function p2002(): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`slug`)',
      { code: 'P2002', clientVersion: 'test', meta: { target: ['slug'] } },
    );
  }

  const prisma: PrismaLike = {
    membership: {
      findFirst: vi.fn(async () => {
        counts.findFirst += 1;
        return opts.existingMembership ?? null;
      }),
    } as unknown as PrismaLike['membership'],
    organization: {} as unknown as PrismaLike['organization'],
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      counts.txOpen += 1;
      const tx = {
        organization: {
          create: vi.fn(async ({ data }: { data: { slug: string; name: string } }) => {
            counts.orgCreate += 1;
            lastSlug = data.slug;
            if (opts.alwaysCollide || opts.collideSlugs?.has(data.slug)) {
              throw p2002();
            }
            return { id: `org-${data.slug}`, slug: data.slug, name: data.name };
          }),
        },
        membership: {
          create: vi.fn(async () => {
            counts.membershipCreate += 1;
            return { id: 'mem-1' };
          }),
        },
        user: {
          updateMany: vi.fn(async () => {
            counts.userUpdate += 1;
            return { count: 1 };
          }),
        },
      };
      return cb(tx);
    }) as unknown as PrismaLike['$transaction'],
  };

  return { prisma, counts, lastSlug: () => lastSlug };
}

describe('slugifyForOrg', () => {
  it('lower-cases, strips diacritics, and dashes non-alphanumerics', () => {
    expect(slugifyForOrg('Álex Über')).toBe('alex-uber');
  });

  it('trims edge dashes', () => {
    expect(slugifyForOrg('---Hello---')).toBe('hello');
  });

  it('falls back to "workspace" for empty / non-ascii input', () => {
    expect(slugifyForOrg('')).toBe('workspace');
    expect(slugifyForOrg('!!!')).toBe('workspace');
    expect(slugifyForOrg('日本語')).toBe('workspace');
  });

  it('caps at 40 chars', () => {
    const long = 'a'.repeat(80);
    expect(slugifyForOrg(long).length).toBe(40);
  });
});

describe('createPersonalOrgForUser', () => {
  it('happy path — derives slug from name and creates Org + Membership atomically', async () => {
    const { prisma, counts, lastSlug } = makePrismaStub();
    await createPersonalOrgForUser(prisma, {
      id: 'user-1',
      email: 'alice@example.com',
      name: 'Alice Example',
    });

    expect(counts.findFirst).toBe(1);
    expect(counts.txOpen).toBe(1);
    expect(counts.orgCreate).toBe(1);
    expect(counts.membershipCreate).toBe(1);
    expect(counts.userUpdate).toBe(1);
    // Name is "Alice Example" → first token "Alice" → slug "alice".
    expect(lastSlug()).toBe('alice');
  });

  it('derives slug from email local-part when name is absent', async () => {
    const { prisma, lastSlug } = makePrismaStub();
    await createPersonalOrgForUser(prisma, {
      id: 'user-2',
      email: 'bob.smith@example.com',
    });
    expect(lastSlug()).toBe('bob-smith');
  });

  it('idempotency — short-circuits when user already has a membership', async () => {
    const { prisma, counts } = makePrismaStub({
      existingMembership: { id: 'mem-existing' },
    });
    await createPersonalOrgForUser(prisma, {
      id: 'user-3',
      email: 'carol@example.com',
    });

    expect(counts.findFirst).toBe(1);
    // Critically: NO transaction opened, NO writes.
    expect(counts.txOpen).toBe(0);
    expect(counts.orgCreate).toBe(0);
    expect(counts.membershipCreate).toBe(0);
    expect(counts.userUpdate).toBe(0);
  });

  it('retries with a hex-suffixed slug on P2002 slug collision', async () => {
    const { prisma, counts, lastSlug } = makePrismaStub({
      collideSlugs: new Set(['dave']),
    });
    await createPersonalOrgForUser(prisma, {
      id: 'user-4',
      email: 'dave@example.com',
      name: 'Dave',
    });

    expect(counts.txOpen).toBe(2); // first attempt collided, second succeeded
    expect(counts.membershipCreate).toBe(1);
    // Suffixed slug shape: "dave-<4 hex>"
    expect(lastSlug()).toMatch(/^dave-[0-9a-f]{4}$/);
  });

  it('throws "slug exhaustion" when all 5 attempts collide', async () => {
    const { prisma, counts } = makePrismaStub({ alwaysCollide: true });
    await expect(
      createPersonalOrgForUser(prisma, {
        id: 'user-5',
        email: 'eve@example.com',
        name: 'Eve',
      }),
    ).rejects.toThrow(/slug exhaustion/i);
    expect(counts.txOpen).toBe(5);
    expect(counts.membershipCreate).toBe(0);
  });

  it('re-throws non-collision errors without retrying', async () => {
    const { prisma } = makePrismaStub();
    // Replace $transaction to throw a generic error.
    (prisma as { $transaction: unknown }).$transaction = vi.fn(async () => {
      throw new Error('db is on fire');
    });

    await expect(
      createPersonalOrgForUser(prisma, {
        id: 'user-6',
        email: 'frank@example.com',
      }),
    ).rejects.toThrow(/db is on fire/);
  });
});
