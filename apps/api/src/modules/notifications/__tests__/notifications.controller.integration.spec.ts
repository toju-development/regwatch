/**
 * HTTP integration tests for `NotificationsController`.
 *
 * sdd/notify-slack/spec R "Channel CRUD Endpoints":
 *  - GET /notifications/channels → 200 (authenticated)
 *  - POST /notifications/channels → 200 (upsert idempotency)
 *  - PATCH /notifications/channels/:id → 200
 *  - DELETE /notifications/channels/:id → 204
 *  - Unauthenticated → 401
 *  - Cross-org PATCH → 403
 *
 * Boots full AppModule against real Postgres (skipped when DB unreachable).
 * Follows same patterns as alerts.integration.spec.ts.
 *
 * NO `pnpm build` after changes (project rule).
 */

import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@regwatch/db/client';
import type { MembershipClaim, Role } from '@regwatch/types';

// ─── env bootstrap ─────────────────────────────────────────────────────────

const PLACEHOLDER_DB_URL = 'postgresql://test:test@localhost:5432/test';
if (!process.env.DATABASE_URL || process.env.DATABASE_URL === PLACEHOLDER_DB_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:root@localhost:5432/regwatch_dev?schema=public';
}
const AUTH_SECRET = process.env.AUTH_SECRET ?? 'test-auth-secret-must-be-at-least-32-chars-ok';
process.env.AUTH_SECRET = AUTH_SECRET;
process.env.MANUAL_INGEST_ENABLED = 'true';
process.env.SCANNER_INTERNAL_SECRET = 'test-internal-secret';
process.env.SCANNER_INTERNAL_URL = 'http://localhost:9999';

// ─── DB probe ─────────────────────────────────────────────────────────────────

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

// ─── JWT helper ───────────────────────────────────────────────────────────────

async function mintJwt(opts: {
  userId: string;
  email: string;
  memberships: MembershipClaim[];
}): Promise<string> {
  const key = new TextEncoder().encode(AUTH_SECRET);
  return new SignJWT({
    userId: opts.userId,
    email: opts.email,
    memberships: opts.memberships,
    mv: 0,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(opts.userId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe.skipIf(!dbAvailable)('NotificationsController (HTTP integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let prisma: PrismaClient;

  const createdUserIds = new Set<string>();
  const createdOrgIds = new Set<string>();

  beforeAll(async () => {
    const { AppModule } = await import('../../../app.module.js');
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
    // Clean up notification channels (FK: org CASCADE handles them on org delete)
    if (createdOrgIds.size > 0) {
      await prisma.notificationChannel.deleteMany({
        where: { organizationId: { in: [...createdOrgIds] } },
      });
      await prisma.organization.deleteMany({ where: { id: { in: [...createdOrgIds] } } });
    }
    if (createdUserIds.size > 0) {
      await prisma.user.updateMany({
        where: { id: { in: [...createdUserIds] } },
        data: { personalOrgId: null },
      });
      await prisma.user.deleteMany({ where: { id: { in: [...createdUserIds] } } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  // ─── Seed helpers ──────────────────────────────────────────────────────────

  async function createUser(): Promise<{ userId: string; email: string }> {
    const tag = randomBytes(6).toString('hex');
    const userId = `int-notif-${tag}`;
    const email = `${userId}@test.local`;
    createdUserIds.add(userId);
    await prisma.user.create({ data: { id: userId, email } });
    return { userId, email };
  }

  async function createOrg(): Promise<{ id: string; slug: string }> {
    const tag = randomBytes(6).toString('hex');
    const org = await prisma.organization.create({
      data: { slug: `int-notif-${tag}`, name: `Notif Org ${tag}` },
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
    return mintJwt({
      userId: actor.userId,
      email: actor.email,
      memberships: [{ organizationId: org.id, orgSlug: org.slug, role }],
    });
  }

  // ── Unauthenticated ──────────────────────────────────────────────────────────

  it('GET /notifications/channels — no JWT → 401', async () => {
    const user = await createUser();
    const org = await createOrg();
    await addMembership(user.userId, org.id, 'OWNER');

    const res = await fetch(`${baseUrl}/notifications/channels`, {
      headers: { 'x-org-id': org.id },
    });
    expect(res.status).toBe(401);
  });

  // ── GET /notifications/channels ──────────────────────────────────────────────

  it('GET /notifications/channels → 200 with empty array initially', async () => {
    const user = await createUser();
    const org = await createOrg();
    await addMembership(user.userId, org.id, 'OWNER');
    const jwt = await getJwt(user, org, 'OWNER');

    const res = await fetch(`${baseUrl}/notifications/channels`, {
      headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  // ── POST — upsert idempotency ────────────────────────────────────────────────

  it('POST /notifications/channels — creates then idempotent on second call', async () => {
    const user = await createUser();
    const org = await createOrg();
    await addMembership(user.userId, org.id, 'ADMIN');
    const jwt = await getJwt(user, org, 'ADMIN');

    const payload = {
      provider: 'SLACK',
      webhookUrl: 'https://hooks.slack.com/services/test/first',
      channelName: 'compliance',
    };

    const res1 = await fetch(`${baseUrl}/notifications/channels`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${jwt}`,
        'x-org-id': org.id,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    expect(res1.status).toBe(200);
    const channel1 = (await res1.json()) as { id: string; webhookUrl: string };
    expect(channel1.webhookUrl).toBe(payload.webhookUrl);

    // Second POST with updated URL → same row updated, not duplicated
    const res2 = await fetch(`${baseUrl}/notifications/channels`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${jwt}`,
        'x-org-id': org.id,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ...payload,
        webhookUrl: 'https://hooks.slack.com/services/test/updated',
      }),
    });
    expect(res2.status).toBe(200);
    const channel2 = (await res2.json()) as { id: string; webhookUrl: string };
    expect(channel2.id).toBe(channel1.id); // same record
    expect(channel2.webhookUrl).toBe('https://hooks.slack.com/services/test/updated');

    // Verify only one channel exists
    const listRes = await fetch(`${baseUrl}/notifications/channels`, {
      headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
    });
    const channels = (await listRes.json()) as unknown[];
    expect(channels).toHaveLength(1);
  });

  // ── PATCH ────────────────────────────────────────────────────────────────────

  it('PATCH /notifications/channels/:id → 200 with updated fields', async () => {
    const user = await createUser();
    const org = await createOrg();
    await addMembership(user.userId, org.id, 'OWNER');
    const jwt = await getJwt(user, org, 'OWNER');

    // Create first
    const createRes = await fetch(`${baseUrl}/notifications/channels`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${jwt}`,
        'x-org-id': org.id,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'SLACK',
        webhookUrl: 'https://hooks.slack.com/original',
      }),
    });
    const channel = (await createRes.json()) as { id: string };

    // Patch
    const patchRes = await fetch(`${baseUrl}/notifications/channels/${channel.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${jwt}`,
        'x-org-id': org.id,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ isActive: false }),
    });

    expect(patchRes.status).toBe(200);
    const updated = (await patchRes.json()) as { isActive: boolean };
    expect(updated.isActive).toBe(false);
  });

  // ── DELETE ───────────────────────────────────────────────────────────────────

  it('DELETE /notifications/channels/:id → 204', async () => {
    const user = await createUser();
    const org = await createOrg();
    await addMembership(user.userId, org.id, 'OWNER');
    const jwt = await getJwt(user, org, 'OWNER');

    const createRes = await fetch(`${baseUrl}/notifications/channels`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${jwt}`,
        'x-org-id': org.id,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'SLACK',
        webhookUrl: 'https://hooks.slack.com/to-delete',
      }),
    });
    const channel = (await createRes.json()) as { id: string };

    const deleteRes = await fetch(`${baseUrl}/notifications/channels/${channel.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
    });
    expect(deleteRes.status).toBe(204);

    // Verify gone
    const listRes = await fetch(`${baseUrl}/notifications/channels`, {
      headers: { authorization: `Bearer ${jwt}`, 'x-org-id': org.id },
    });
    const channels = (await listRes.json()) as unknown[];
    expect(channels).toHaveLength(0);
  });

  // ── Cross-org 403 ─────────────────────────────────────────────────────────────

  it('PATCH /notifications/channels/:id — cross-org → 403', async () => {
    // Org A creates a channel
    const userA = await createUser();
    const orgA = await createOrg();
    await addMembership(userA.userId, orgA.id, 'OWNER');
    const jwtA = await getJwt(userA, orgA, 'OWNER');

    const createRes = await fetch(`${baseUrl}/notifications/channels`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${jwtA}`,
        'x-org-id': orgA.id,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'SLACK',
        webhookUrl: 'https://hooks.slack.com/orga',
      }),
    });
    const channelA = (await createRes.json()) as { id: string };

    // Org B tries to PATCH org A's channel
    const userB = await createUser();
    const orgB = await createOrg();
    await addMembership(userB.userId, orgB.id, 'OWNER');
    const jwtB = await getJwt(userB, orgB, 'OWNER');

    const res = await fetch(`${baseUrl}/notifications/channels/${channelA.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${jwtB}`,
        'x-org-id': orgB.id,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ isActive: false }),
    });
    expect(res.status).toBe(403);
  });
});
