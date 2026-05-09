/**
 * Unit tests for `AlertsService` — state machine + business rules.
 *
 * sdd/alert-collaboration/spec Phase 5.1:
 *   - Transition happy paths
 *   - Invalid transition → throws UnprocessableEntityException
 *   - DISTRIBUTED blocked for humans → ForbiddenException
 *   - CONCLUDED requires conclusion → throws with CONCLUSION_REQUIRED
 *   - ANALYST cannot transition to CONCLUDED
 *   - assign: INV-COLLAB-1 — non-member assigneeId → throws
 *   - assign: null assigneeId (unassign) → succeeds
 *   - addComment: parentId depth > 1 → throws 400
 *   - EventEmitter2 called post-commit
 *
 * NO `pnpm build` after changes (project rule).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  UnprocessableEntityException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { AlertsService } from '../alerts.service.js';
import type { AlertsRepo, AlertWithMeta, CommentRow } from '../alerts.repository.js';
import { ALERT_CONCLUDED_EVENT } from '@regwatch/types';

// ─── Minimal alert fixture ─────────────────────────────────────────────────

function makeAlert(overrides: Partial<AlertWithMeta> = {}): AlertWithMeta {
  return {
    id: 'alert-1',
    organizationId: 'org-1',
    status: 'NEW',
    assigneeId: null,
    conclusion: null,
    regulator: null,
    title: 'Test Alert',
    summary: null,
    fullContent: null,
    publishedAt: null,
    detectedAt: new Date(),
    source: 'MANUAL',
    sourceUrl: 'https://example.com',
    severity: 'HIGH',
    enrichmentStatus: 'DONE',
    executiveSummary: null,
    whatChangesForYou: null,
    assignee: null,
    _count: { comments: 0 },
    ...overrides,
  };
}

// ─── Mock repo ────────────────────────────────────────────────────────────────

function makeRepo(overrides: Partial<AlertsRepo> = {}): AlertsRepo {
  return {
    findById: vi.fn().mockResolvedValue(makeAlert()),
    listByOrg: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    updateAlert: vi.fn().mockResolvedValue(undefined),
    createEvent: vi.fn().mockResolvedValue(undefined),
    isMember: vi.fn().mockResolvedValue(true),
    $transaction: vi.fn().mockImplementation(async (cb) => cb({})),
    findComments: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    createComment: vi.fn().mockResolvedValue({
      id: 'comment-1',
      alertId: 'alert-1',
      organizationId: 'org-1',
      authorId: 'user-1',
      body: 'Hello',
      parentId: null,
      editedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as CommentRow),
    findComment: vi.fn().mockResolvedValue(null),
    findParentComment: vi.fn().mockResolvedValue(null),
    deleteComment: vi.fn().mockResolvedValue(undefined),
    findEvents: vi.fn().mockResolvedValue([]),
    statsForOrg: vi.fn().mockResolvedValue({ total: 0, byStatus: {} }),
    ...overrides,
  } as unknown as AlertsRepo;
}

// ─── Mock EventEmitter2 ───────────────────────────────────────────────────────

function makeEmitter() {
  return { emit: vi.fn() };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

function makeService(repo = makeRepo(), emitter = makeEmitter()): AlertsService {
  return new (AlertsService as unknown as new (repo: unknown, emitter: unknown) => AlertsService)(
    repo,
    emitter,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AlertsService.transition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('NEW → TRIAGING: happy path for ANALYST', async () => {
    const repo = makeRepo({ findById: vi.fn().mockResolvedValue(makeAlert({ status: 'NEW' })) });
    const emitter = makeEmitter();
    const service = makeService(repo, emitter);

    await service.transition('org-1', 'alert-1', 'TRIAGING', { id: 'user-1', role: 'ANALYST' });

    expect(repo.updateAlert).toHaveBeenCalled();
    expect(repo.createEvent).toHaveBeenCalled();
    expect(emitter.emit).toHaveBeenCalled();
  });

  it('TRIAGING → ANALYZING: happy path for ADMIN', async () => {
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(makeAlert({ status: 'TRIAGING' })),
    });
    const service = makeService(repo);

    await service.transition('org-1', 'alert-1', 'ANALYZING', { id: 'user-1', role: 'ADMIN' });

    expect(repo.updateAlert).toHaveBeenCalled();
  });

  it('TRIAGING → ANALYZING: happy path for assignee (ANALYST)', async () => {
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(makeAlert({ status: 'TRIAGING', assigneeId: 'user-1' })),
    });
    const service = makeService(repo);

    await service.transition('org-1', 'alert-1', 'ANALYZING', { id: 'user-1', role: 'ANALYST' });

    expect(repo.updateAlert).toHaveBeenCalled();
  });

  it('DEBATING → CONCLUDED: happy path (conclusion set)', async () => {
    const repo = makeRepo({
      findById: vi
        .fn()
        .mockResolvedValue(
          makeAlert({ status: 'DEBATING', conclusion: 'This is the conclusion.' }),
        ),
    });
    const service = makeService(repo);

    await service.transition('org-1', 'alert-1', 'CONCLUDED', { id: 'user-1', role: 'OWNER' });

    expect(repo.updateAlert).toHaveBeenCalled();
  });

  it('DEBATING → CONCLUDED emits alert.concluded event', async () => {
    const repo = makeRepo({
      findById: vi
        .fn()
        .mockResolvedValue(
          makeAlert({ status: 'DEBATING', conclusion: 'This is the conclusion.' }),
        ),
    });
    const emitter = makeEmitter();
    const service = makeService(repo, emitter);

    await service.transition(
      'org-1',
      'alert-1',
      'CONCLUDED',
      { id: 'user-1', role: 'OWNER' },
      'note',
    );

    const calls = emitter.emit.mock.calls;
    const concludedCall = calls.find((c) => c[0] === ALERT_CONCLUDED_EVENT);
    expect(concludedCall).toBeDefined();
    expect(concludedCall![1]).toMatchObject({
      alertId: 'alert-1',
      organizationId: 'org-1',
      actorId: 'user-1',
      fromStatus: 'DEBATING',
      note: 'note',
    });
  });

  it('invalid transition NEW → CONCLUDED throws UnprocessableEntityException', async () => {
    const repo = makeRepo({ findById: vi.fn().mockResolvedValue(makeAlert({ status: 'NEW' })) });
    const service = makeService(repo);

    await expect(
      service.transition('org-1', 'alert-1', 'CONCLUDED', { id: 'user-1', role: 'OWNER' }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('CONCLUDED → DISTRIBUTED blocked for human actors → ForbiddenException', async () => {
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(makeAlert({ status: 'CONCLUDED' })),
    });
    const service = makeService(repo);

    await expect(
      service.transition('org-1', 'alert-1', 'DISTRIBUTED', { id: 'user-1', role: 'OWNER' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('ANALYZING → CONCLUDED requires conclusion → throws UnprocessableEntityException', async () => {
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(makeAlert({ status: 'ANALYZING', conclusion: null })),
    });
    const service = makeService(repo);

    await expect(
      service.transition('org-1', 'alert-1', 'CONCLUDED', { id: 'user-1', role: 'OWNER' }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('ANALYST cannot transition to CONCLUDED → ForbiddenException', async () => {
    const repo = makeRepo({
      findById: vi
        .fn()
        .mockResolvedValue(makeAlert({ status: 'DEBATING', conclusion: 'Some conclusion' })),
    });
    const service = makeService(repo);

    await expect(
      service.transition('org-1', 'alert-1', 'CONCLUDED', { id: 'user-1', role: 'ANALYST' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('alert not found → NotFoundException', async () => {
    const repo = makeRepo({ findById: vi.fn().mockResolvedValue(null) });
    const service = makeService(repo);

    await expect(
      service.transition('org-1', 'alert-x', 'TRIAGING', { id: 'user-1', role: 'ADMIN' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('EventEmitter2 emit failure does NOT rethrow', async () => {
    const repo = makeRepo({ findById: vi.fn().mockResolvedValue(makeAlert({ status: 'NEW' })) });
    const emitter = {
      emit: vi.fn().mockImplementation(() => {
        throw new Error('bus error');
      }),
    };
    const service = makeService(repo, emitter);

    // Should NOT throw despite emitter throwing
    await expect(
      service.transition('org-1', 'alert-1', 'TRIAGING', { id: 'user-1', role: 'ANALYST' }),
    ).resolves.not.toThrow();
  });
});

describe('AlertsService.assign', () => {
  beforeEach(() => vi.clearAllMocks());

  it('INV-COLLAB-1: non-member assigneeId → UnprocessableEntityException', async () => {
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(makeAlert()),
      isMember: vi.fn().mockResolvedValue(false),
    });
    const service = makeService(repo);

    await expect(
      service.assign('org-1', 'alert-1', 'non-member-id', { id: 'user-1', role: 'ADMIN' }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('null assigneeId (unassign) → succeeds without isMember check', async () => {
    const repo = makeRepo({ findById: vi.fn().mockResolvedValue(makeAlert()) });
    const service = makeService(repo);

    await service.assign('org-1', 'alert-1', null, { id: 'user-1', role: 'ADMIN' });

    expect(repo.isMember).not.toHaveBeenCalled();
    expect(repo.updateAlert).toHaveBeenCalled();
  });

  it('valid member assigneeId → succeeds', async () => {
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(makeAlert()),
      isMember: vi.fn().mockResolvedValue(true),
    });
    const service = makeService(repo);

    await service.assign('org-1', 'alert-1', 'member-id', { id: 'user-1', role: 'ADMIN' });

    expect(repo.updateAlert).toHaveBeenCalled();
  });
});

describe('AlertsService.addComment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('parentId depth > 1 → BadRequestException', async () => {
    const grandparentComment = {
      id: 'parent-1',
      alertId: 'alert-1',
      parentId: 'grandparent-id', // non-null → depth > 1
    };
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(makeAlert()),
      findParentComment: vi.fn().mockResolvedValue(grandparentComment),
    });
    const service = makeService(repo);

    await expect(
      service.addComment('org-1', 'alert-1', 'Hello', 'parent-1', {
        id: 'user-1',
        role: 'ANALYST',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('top-level comment → succeeds', async () => {
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(makeAlert()),
    });
    const service = makeService(repo);

    const comment = await service.addComment('org-1', 'alert-1', 'Hello', undefined, {
      id: 'user-1',
      role: 'ANALYST',
    });

    expect(repo.createComment).toHaveBeenCalled();
    expect(comment).toBeDefined();
  });
});

describe('AlertsService.getStats', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to repo.statsForOrg and returns the result', async () => {
    const stats = {
      total: 10,
      byStatus: {
        NEW: 3,
        TRIAGING: 2,
        ANALYZING: 1,
        DEBATING: 1,
        CONCLUDED: 2,
        DISTRIBUTED: 1,
        ARCHIVED: 0,
      },
    };
    const repo = makeRepo({ statsForOrg: vi.fn().mockResolvedValue(stats) } as Partial<AlertsRepo>);
    const service = makeService(repo);

    const result = await service.getStats('org-1');

    expect(repo.statsForOrg).toHaveBeenCalledWith('org-1');
    expect(result).toBe(stats);
  });
});

describe('AlertsService.conclude', () => {
  beforeEach(() => vi.clearAllMocks());

  it('OWNER can set conclusion', async () => {
    const repo = makeRepo({ findById: vi.fn().mockResolvedValue(makeAlert()) });
    const service = makeService(repo);

    await service.conclude('org-1', 'alert-1', 'My conclusion', { id: 'user-1', role: 'OWNER' });

    expect(repo.updateAlert).toHaveBeenCalled();
  });

  it('ANALYST cannot set conclusion → ForbiddenException', async () => {
    const repo = makeRepo({ findById: vi.fn().mockResolvedValue(makeAlert()) });
    const service = makeService(repo);

    await expect(
      service.conclude('org-1', 'alert-1', 'conclusion', { id: 'user-1', role: 'ANALYST' }),
    ).rejects.toThrow(ForbiddenException);
  });
});
