/**
 * HTTP integration tests for the AlertsModule.
 *
 * sdd/alert-collaboration/spec Phase 5.3:
 *   - VIEWER → 403 on PATCH /status
 *   - ANALYST → 200 on valid transition
 *   - Invalid transition → 422
 *   - CONCLUSION_REQUIRED → 422
 *   - Non-member assigneeId → 422
 *   - Comment depth > 1 → 400
 *
 * Boots full AppModule against real Postgres (skipped when DB unreachable).
 * Follows same patterns as ingest.integration.spec.ts.
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
import { AppModule } from '../../../app.module.js';

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

describe.skipIf(!dbAvailable)('AlertsModule (HTTP integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let prisma: PrismaClient;

  const createdUserIds = new Set<string>();
  const createdOrgIds = new Set<string>();
  const createdAlertIds = new Set<string>();

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
    // Clean up alerts first (FK: AlertEvent, AlertComment → Alert)
    if (createdAlertIds.size > 0) {
      await prisma.alertEvent.deleteMany({
        where: { alertId: { in: [...createdAlertIds] } },
      });
      await prisma.alertComment.deleteMany({
        where: { alertId: { in: [...createdAlertIds] } },
      });
      await prisma.alert.deleteMany({ where: { id: { in: [...createdAlertIds] } } });
    }
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

  // ─── Seed helpers ──────────────────────────────────────────────────────────

  async function createUser(): Promise<{ userId: string; email: string }> {
    const tag = randomBytes(6).toString('hex');
    const userId = `int-alerts-${tag}`;
    const email = `${userId}@test.local`;
    createdUserIds.add(userId);
    await prisma.user.create({ data: { id: userId, email } });
    return { userId, email };
  }

  async function createOrg(): Promise<{ id: string; slug: string }> {
    const tag = randomBytes(6).toString('hex');
    const org = await prisma.organization.create({
      data: { slug: `int-alrt-${tag}`, name: `Alerts Org ${tag}` },
      select: { id: true, slug: true },
    });
    createdOrgIds.add(org.id);
    return org;
  }

  async function addMembership(userId: string, orgId: string, role: Role): Promise<void> {
    await prisma.membership.create({ data: { userId, organizationId: orgId, role } });
  }

  async function createAlert(orgId: string): Promise<{ id: string }> {
    const tag = randomBytes(6).toString('hex');
    const alert = await prisma.alert.create({
      data: {
        organizationId: orgId,
        status: 'NEW',
        title: `Integration Alert ${tag}`,
        source: 'MANUAL',
        sourceUrl: `manual:text:${tag}`,
        sourceUrlHash: tag,
        severity: 'HIGH',
        enrichmentStatus: 'PENDING',
        detectedAt: new Date(),
      },
      select: { id: true },
    });
    createdAlertIds.add(alert.id);
    return alert;
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

  // ─── Tests ─────────────────────────────────────────────────────────────────

  it('VIEWER → 403 on PATCH /alerts/:id/status', async () => {
    const org = await createOrg();
    const actor = await createUser();
    await addMembership(actor.userId, org.id, 'VIEWER');
    const jwt = await getJwt(actor, org, 'VIEWER');
    const alert = await createAlert(org.id);

    const res = await fetch(`${baseUrl}/alerts/${alert.id}/status`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${jwt}`,
        'x-org-id': org.id,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'TRIAGING' }),
    });

    expect(res.status).toBe(403);
  });

  it('ANALYST → 200 on valid transition NEW → TRIAGING', async () => {
    const org = await createOrg();
    const actor = await createUser();
    await addMembership(actor.userId, org.id, 'ANALYST');
    const jwt = await getJwt(actor, org, 'ANALYST');
    const alert = await createAlert(org.id);

    const res = await fetch(`${baseUrl}/alerts/${alert.id}/status`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${jwt}`,
        'x-org-id': org.id,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'TRIAGING' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('TRIAGING');
  });

  it('Invalid transition NEW → CONCLUDED → 422', async () => {
    const org = await createOrg();
    const actor = await createUser();
    await addMembership(actor.userId, org.id, 'OWNER');
    const jwt = await getJwt(actor, org, 'OWNER');
    const alert = await createAlert(org.id);

    const res = await fetch(`${baseUrl}/alerts/${alert.id}/status`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${jwt}`,
        'x-org-id': org.id,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'CONCLUDED' }),
    });

    expect(res.status).toBe(422);
  });

  it('CONCLUSION_REQUIRED: ANALYZING → CONCLUDED without conclusion → 422', async () => {
    const org = await createOrg();
    const actor = await createUser();
    await addMembership(actor.userId, org.id, 'OWNER');
    const jwt = await getJwt(actor, org, 'OWNER');

    // Create alert in ANALYZING status
    const alert = await createAlert(org.id);
    await prisma.alert.update({ where: { id: alert.id }, data: { status: 'ANALYZING' } });

    const res = await fetch(`${baseUrl}/alerts/${alert.id}/status`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${jwt}`,
        'x-org-id': org.id,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'CONCLUDED' }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('CONCLUSION_REQUIRED');
  });

  it('Non-member assigneeId → 422', async () => {
    const org = await createOrg();
    const actor = await createUser();
    await addMembership(actor.userId, org.id, 'ADMIN');
    const jwt = await getJwt(actor, org, 'ADMIN');
    const alert = await createAlert(org.id);

    const res = await fetch(`${baseUrl}/alerts/${alert.id}/assignee`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${jwt}`,
        'x-org-id': org.id,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ assigneeId: 'non-existent-user-id' }),
    });

    expect(res.status).toBe(422);
  });

  it('Comment depth > 1 → 400', async () => {
    const org = await createOrg();
    const actor = await createUser();
    await addMembership(actor.userId, org.id, 'ANALYST');
    const jwt = await getJwt(actor, org, 'ANALYST');
    const alert = await createAlert(org.id);

    // Create a top-level comment
    const rootComment = await prisma.alertComment.create({
      data: {
        alertId: alert.id,
        organizationId: org.id,
        authorId: actor.userId,
        body: 'Root comment',
      },
    });

    // Create a reply (depth 1)
    const replyComment = await prisma.alertComment.create({
      data: {
        alertId: alert.id,
        organizationId: org.id,
        authorId: actor.userId,
        body: 'Reply comment',
        parentId: rootComment.id,
      },
    });

    // Attempt reply to reply (depth 2) → 400
    const res = await fetch(`${baseUrl}/alerts/${alert.id}/comments`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${jwt}`,
        'x-org-id': org.id,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ body: 'Nested reply', parentId: replyComment.id }),
    });

    expect(res.status).toBe(400);
  });
});
