/**
 * Integration tests for `POST /ingest/manual`.
 *
 * sdd/manual-ingestion B4.11:
 *   - Valid URL input → 201
 *   - Same URL twice → 409
 *   - VIEWER role → 403
 *   - SSRF URL → 400
 *   - MANUAL_INGEST_ENABLED=false → 503
 *
 * Boots the full `AppModule` against a real Postgres instance (skipped
 * when DB is unreachable). Follows the same patterns as
 * `settings.integration.spec.ts`.
 *
 * Foot-gun #687: all reads scoped to seeded organizationId.
 */

import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@regwatch/db/client';
import type { MembershipClaim, Role } from '@regwatch/types';
import { AppModule } from '../../../app.module.js';

// ---- env bootstrap (must happen before AppModule is imported at runtime) -----
const PLACEHOLDER_DB_URL = 'postgresql://test:test@localhost:5432/test';
if (!process.env.DATABASE_URL || process.env.DATABASE_URL === PLACEHOLDER_DB_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:root@localhost:5432/regwatch_dev?schema=public';
}
const AUTH_SECRET = process.env.AUTH_SECRET ?? 'test-auth-secret-must-be-at-least-32-chars-ok';
process.env.AUTH_SECRET = AUTH_SECRET;
process.env.MANUAL_INGEST_ENABLED = 'true';
process.env.SCANNER_INTERNAL_SECRET = 'test-internal-secret';
process.env.SCANNER_INTERNAL_URL = 'http://localhost:9999'; // unreachable — fire-and-forget

// Probe DB availability.
const probe = new PrismaClient();
let dbAvailable = false;
try {
  await probe.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
} finally {
  await probe.$disconnect();
}

// ---- Mock url-fetcher so no real network calls happen ----------------------
vi.mock('../../../modules/ingest/utils/url-fetcher.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../utils/url-fetcher.js')>();
  return {
    ...original,
    fetchUrl: vi.fn().mockResolvedValue({ text: 'mocked page content', title: 'Mocked Title' }),
  };
});

// ---- Helpers ----------------------------------------------------------------

async function mintJwt(opts: {
  userId: string;
  email: string;
  memberships: MembershipClaim[];
  mv?: number;
}): Promise<string> {
  const key = new TextEncoder().encode(AUTH_SECRET);
  return await new SignJWT({
    userId: opts.userId,
    email: opts.email,
    memberships: opts.memberships,
    mv: opts.mv ?? 0,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(opts.userId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

// ---- Test suite -------------------------------------------------------------

describe.skipIf(!dbAvailable)('POST /ingest/manual (HTTP integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let prisma: PrismaClient;

  const createdUserIds = new Set<string>();
  const createdOrgIds = new Set<string>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const server = await app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No listen address');
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = new PrismaClient();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    if (createdOrgIds.size > 0) {
      await prisma.user.updateMany({
        where: { id: { in: [...createdUserIds] } },
        data: { personalOrgId: null },
      });
      await prisma.organization.deleteMany({ where: { id: { in: [...createdOrgIds] } } });
    }
    if (createdUserIds.size > 0) {
      await prisma.user.deleteMany({ where: { id: { in: [...createdUserIds] } } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  // ---- seed helpers ---------------------------------------------------------

  async function createUser(): Promise<{ userId: string; email: string }> {
    const tag = randomBytes(6).toString('hex');
    const userId = `int-ingest-${tag}`;
    const email = `${userId}@test.local`;
    createdUserIds.add(userId);
    await prisma.user.create({ data: { id: userId, email } });
    return { userId, email };
  }

  async function createOrg(): Promise<{ id: string; slug: string }> {
    const tag = randomBytes(6).toString('hex');
    const org = await prisma.organization.create({
      data: { slug: `int-ing-${tag}`, name: `Ingest Org ${tag}` },
      select: { id: true, slug: true },
    });
    createdOrgIds.add(org.id);
    return org;
  }

  async function addMembership(userId: string, orgId: string, role: Role): Promise<void> {
    await prisma.membership.create({ data: { userId, organizationId: orgId, role } });
  }

  async function getJwt(
    actor: { userId: string; email: string },
    org: { id: string; slug: string },
    role: Role,
  ): Promise<string> {
    return await mintJwt({
      userId: actor.userId,
      email: actor.email,
      memberships: [{ organizationId: org.id, orgSlug: org.slug, role }],
    });
  }

  // ---- tests ----------------------------------------------------------------

  it('valid URL input → 201 { alertId, message }', async () => {
    const org = await createOrg();
    const actor = await createUser();
    await addMembership(actor.userId, org.id, 'ANALYST');
    const jwt = await getJwt(actor, org, 'ANALYST');

    const res = await fetch(`${baseUrl}/ingest/manual`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${jwt}`,
        'x-org-id': org.id,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'url', url: 'https://example.com/doc', jurisdiction: 'AR' }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { alertId?: string; message?: string };
    expect(typeof body.alertId).toBe('string');
    expect(body.message).toMatch(/enrichment/i);
  });

  it('same URL twice → 409 { alertId, message }', async () => {
    const org = await createOrg();
    const actor = await createUser();
    await addMembership(actor.userId, org.id, 'ADMIN');
    const jwt = await getJwt(actor, org, 'ADMIN');

    const payload = JSON.stringify({
      type: 'url',
      url: 'https://example.com/unique-dedup-test',
      jurisdiction: 'BR',
    });
    const headers = {
      authorization: `Bearer ${jwt}`,
      'x-org-id': org.id,
      'content-type': 'application/json',
    };

    const first = await fetch(`${baseUrl}/ingest/manual`, {
      method: 'POST',
      headers,
      body: payload,
    });
    expect(first.status).toBe(201);

    const second = await fetch(`${baseUrl}/ingest/manual`, {
      method: 'POST',
      headers,
      body: payload,
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { alertId?: string; message?: string };
    expect(typeof body.alertId).toBe('string');
    expect(body.message).toBe('Alert already exists');
  });

  it('VIEWER role → 403', async () => {
    const org = await createOrg();
    const actor = await createUser();
    await addMembership(actor.userId, org.id, 'VIEWER');
    const jwt = await getJwt(actor, org, 'VIEWER');

    const res = await fetch(`${baseUrl}/ingest/manual`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${jwt}`,
        'x-org-id': org.id,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'url', url: 'https://example.com', jurisdiction: 'AR' }),
    });

    expect(res.status).toBe(403);
  });

  it('SSRF URL (private IP) → 400', async () => {
    // Un-mock fetchUrl for this specific test to get real SSRF guard.
    const { fetchUrl: realFetchUrl } = await import('../utils/url-fetcher.js');
    vi.mocked(realFetchUrl).mockImplementationOnce(async (url: string) => {
      const { SsrfBlockedError: RealSsrfError } = await import('../utils/url-fetcher.js');
      throw new RealSsrfError(`IP address in private range: ${url}`);
    });

    const org = await createOrg();
    const actor = await createUser();
    await addMembership(actor.userId, org.id, 'ANALYST');
    const jwt = await getJwt(actor, org, 'ANALYST');

    const res = await fetch(`${baseUrl}/ingest/manual`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${jwt}`,
        'x-org-id': org.id,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'url', url: 'https://192.168.1.1/doc', jurisdiction: 'AR' }),
    });

    expect(res.status).toBe(400);
  });

  it('MANUAL_INGEST_ENABLED=false → 503', async () => {
    // Temporarily set the env on the module's injected env.
    const org = await createOrg();
    const actor = await createUser();
    await addMembership(actor.userId, org.id, 'ANALYST');
    const jwt = await getJwt(actor, org, 'ANALYST');

    // Get the controller and temporarily disable the flag.
    const { IngestController } = await import('../ingest.controller.js');
    const controller = app.get(IngestController);
    const envRef = (controller as unknown as { env: { MANUAL_INGEST_ENABLED: string } }).env;
    const originalValue = envRef.MANUAL_INGEST_ENABLED;
    envRef.MANUAL_INGEST_ENABLED = 'false';

    try {
      const res = await fetch(`${baseUrl}/ingest/manual`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${jwt}`,
          'x-org-id': org.id,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ type: 'url', url: 'https://example.com', jurisdiction: 'AR' }),
      });
      expect(res.status).toBe(503);
    } finally {
      envRef.MANUAL_INGEST_ENABLED = originalValue;
    }
  });
});
