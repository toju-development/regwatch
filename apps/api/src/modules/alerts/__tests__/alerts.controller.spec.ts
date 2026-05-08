/**
 * Unit tests for `AlertsController`.
 *
 * sdd/alert-collaboration/spec Phase 5.2:
 *   - VIEWER blocked on PATCH /status → 403
 *   - GET /alerts returns list
 *   - GET /alerts/:id returns detail
 *
 * Uses NestJS test module with mocked AlertsService.
 *
 * NO `pnpm build` after changes (project rule).
 */

import 'reflect-metadata';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { SignJWT } from 'jose';
import type { MembershipClaim } from '@regwatch/types';
import { PrismaClient } from '@regwatch/db/client';
import { AlertsService } from '../alerts.service.js';

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

const ORG_ID = 'org-controller-test';
const VIEWER_ID = 'viewer-user';
const ANALYST_ID = 'analyst-user';

const mockAlertList = { items: [{ id: 'a1', title: 'Test' }], nextCursor: null };
const mockAlert = { id: 'a1', status: 'NEW', title: 'Test' };

// ─── Build minimal AppModule-like test module ─────────────────────────────────

/**
 * We only test the controller in isolation with a mocked service.
 * Guard chain: JwtAuthGuard → OrgScopeGuard → RolesGuard.
 * For simplicity we import the full AppModule to get the guards, but
 * mock the service.
 */

describe.skipIf(!dbAvailable)('AlertsController (unit)', () => {
  let app: INestApplication;
  let baseUrl: string;

  const mockService: Partial<AlertsService> = {
    listAlerts: vi.fn().mockResolvedValue(mockAlertList),
    getAlert: vi.fn().mockResolvedValue(mockAlert),
    transition: vi.fn().mockResolvedValue(mockAlert),
  };

  beforeAll(async () => {
    // Boot the full AppModule but override AlertsService
    const { AppModule } = await import('../../../app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AlertsService)
      .useValue(mockService)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const server = await app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No listen address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  // ── GET /alerts ────────────────────────────────────────────────────────────

  it('GET /alerts — ANALYST → 200', async () => {
    const jwt = await mintJwt({
      userId: ANALYST_ID,
      email: 'analyst@test.local',
      memberships: [{ organizationId: ORG_ID, orgSlug: 'org-ctrl-test', role: 'ANALYST' }],
    });

    const res = await fetch(`${baseUrl}/alerts`, {
      headers: {
        authorization: `Bearer ${jwt}`,
        'x-org-id': ORG_ID,
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof mockAlertList;
    expect(body.items).toBeDefined();
  });

  // ── GET /alerts/:id ────────────────────────────────────────────────────────

  it('GET /alerts/a1 — VIEWER → 200 (read-only allowed)', async () => {
    const jwt = await mintJwt({
      userId: VIEWER_ID,
      email: 'viewer@test.local',
      memberships: [{ organizationId: ORG_ID, orgSlug: 'org-ctrl-test', role: 'VIEWER' }],
    });

    const res = await fetch(`${baseUrl}/alerts/a1`, {
      headers: {
        authorization: `Bearer ${jwt}`,
        'x-org-id': ORG_ID,
      },
    });

    expect(res.status).toBe(200);
  });

  // ── PATCH /alerts/:id/status — VIEWER blocked ──────────────────────────────

  it('PATCH /alerts/a1/status — VIEWER → 403', async () => {
    const jwt = await mintJwt({
      userId: VIEWER_ID,
      email: 'viewer@test.local',
      memberships: [{ organizationId: ORG_ID, orgSlug: 'org-ctrl-test', role: 'VIEWER' }],
    });

    const res = await fetch(`${baseUrl}/alerts/a1/status`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${jwt}`,
        'x-org-id': ORG_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'TRIAGING' }),
    });

    expect(res.status).toBe(403);
  });
});
