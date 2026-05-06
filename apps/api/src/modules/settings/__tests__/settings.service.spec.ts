import 'reflect-metadata';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Settings } from '@regwatch/db/client';
import {
  DEFAULT_SETTINGS,
  SETTINGS_UPDATED_EVENT,
  SettingsUpdatedEventSchema,
  UpdateSettingsSchema,
  type UpdateSettingsInput,
} from '@regwatch/types';
import { describe, expect, it, vi } from 'vitest';
import type { SettingsRepo } from '../settings.repo.js';
import { SettingsService } from '../settings.service.js';

/**
 * Unit suite for `SettingsService` (B2).
 *
 * Spec: `sdd/jurisdictions-config/spec` R-Settings-Get-Or-Create,
 *   R-Settings-Update, R-Settings-Updated-Event, R-Settings-Validation.
 * Design: `sdd/jurisdictions-config/design` §0 D8 (PUT only),
 *   D13 (POST-commit emit), §6 (schema validation), §7 (event payload).
 *
 * Scope: pure service-layer behaviour — repo + EventEmitter2 are mocked
 * via `vi.fn()`. The HTTP layer + Prisma round-trip are covered by the
 * B3 controller spec + an integration suite (out of scope for B2).
 *
 * Two of the six tests poke the canonical `UpdateSettingsSchema` directly
 * (the parametrized `it.each`) — the validation chain belongs to the
 * `ZodBodyPipe` at the controller layer, but the schema lives in
 * `@regwatch/types` and is the contract the service trusts. Pinning the
 * cross-row invariants here catches drift in the schema contract early
 * without needing a full HTTP boot.
 */

const FIXED_NOW = new Date('2026-04-01T12:00:00.000Z');

function makeRepo(overrides: Partial<SettingsRepo> = {}): SettingsRepo {
  return {
    findByOrgId: vi.fn(),
    upsertDefault: vi.fn(),
    replace: vi.fn(),
    ...overrides,
  };
}

function makeEvents(): EventEmitter2 {
  return { emit: vi.fn() } as unknown as EventEmitter2;
}

function makeSettingsRow(overrides: Partial<Settings> = {}): Settings {
  return {
    id: 'settings_1',
    organizationId: 'org_1',
    jurisdictions: DEFAULT_SETTINGS.jurisdictions as unknown as Settings['jurisdictions'],
    scanSchedule: DEFAULT_SETTINGS.scanSchedule,
    scanDay: DEFAULT_SETTINGS.scanDay,
    scanHour: DEFAULT_SETTINGS.scanHour,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    outputLanguage: null,
    lastSkippedCapAt: null,
    ...overrides,
  };
}

describe('SettingsService', () => {
  describe('getOrCreate', () => {
    it('returns the existing row WITHOUT calling upsertDefault on the steady-state read', async () => {
      // R-Settings-Get-Or-Create: "GET MUST NOT mutate when a row exists."
      // The two-step (SELECT-then-UPSERT) exists precisely so the hot
      // path is one SELECT — issuing an UPDATE on every GET would grab
      // row locks under READ COMMITTED for no reason.
      const existing = makeSettingsRow({ scanHour: 14 });
      const repo = makeRepo({
        findByOrgId: vi.fn().mockResolvedValue(existing),
      });
      const events = makeEvents();
      const svc = new SettingsService(repo, events);

      const result = await svc.getOrCreate('org_1');

      expect(result).toBe(existing);
      expect(repo.findByOrgId).toHaveBeenCalledWith('org_1');
      expect(repo.upsertDefault).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('lazy-creates with DEFAULT_SETTINGS when no row exists yet (race-safe via upsertDefault)', async () => {
      // R-Settings-Get-Or-Create: "First-GET MUST create with defaults"
      // R-Settings-Race-Safe: foot-gun #645 — `upsertDefault` tries
      // INSERT and recovers from P2002 via findUnique; the unique index
      // on `organizationId` is the gate, not the prior SELECT.
      const created = makeSettingsRow();
      const repo = makeRepo({
        findByOrgId: vi.fn().mockResolvedValue(null),
        upsertDefault: vi.fn().mockResolvedValue(created),
      });
      const events = makeEvents();
      const svc = new SettingsService(repo, events);

      const result = await svc.getOrCreate('org_new');

      expect(result).toBe(created);
      expect(repo.findByOrgId).toHaveBeenCalledWith('org_new');
      expect(repo.upsertDefault).toHaveBeenCalledWith('org_new');
      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const dto: UpdateSettingsInput = {
      jurisdictions: [
        { code: 'MX', enabled: true, customTopics: 'IVA, ISR' },
        { code: 'CO', enabled: false, customTopics: '' },
      ],
      scanSchedule: 'weekly',
      scanDay: 'tue',
      scanHour: 9,
    };

    it('persists THEN emits settings.updated POST-commit (write before emit)', async () => {
      // R-Settings-Update + design D13: emit MUST be POST-commit so a
      // listener failure cannot roll back the persisted state. We assert
      // this by mock-call ordering — `replace` resolves first, `emit`
      // fires second.
      const saved = makeSettingsRow({
        jurisdictions: dto.jurisdictions as unknown as Settings['jurisdictions'],
        scanSchedule: dto.scanSchedule,
        scanDay: dto.scanDay,
        scanHour: dto.scanHour,
        updatedAt: new Date('2026-04-29T10:00:00.000Z'),
      });
      const replace = vi.fn().mockResolvedValue(saved);
      const emit = vi.fn();
      const repo = makeRepo({ replace });
      const events = { emit } as unknown as EventEmitter2;
      const svc = new SettingsService(repo, events);

      const result = await svc.update('org_1', dto, 'user_actor');

      expect(result).toBe(saved);
      expect(replace).toHaveBeenCalledWith('org_1', dto);
      expect(emit).toHaveBeenCalledTimes(1);
      // Order assertion via invocation timestamps in vi mocks.
      const replaceOrder = replace.mock.invocationCallOrder[0];
      const emitOrder = emit.mock.invocationCallOrder[0];
      expect(replaceOrder).toBeLessThan(emitOrder ?? 0);
    });

    it('does NOT emit when repo.replace rejects (no half-state events)', async () => {
      // R-Settings-Updated-Event: the event MUST reflect committed state.
      // The early-throw from `await repo.replace(...)` exits the method
      // before the emit line — no try/catch needed; we just pin the
      // observable contract here.
      const boom = new Error('db down');
      const repo = makeRepo({
        replace: vi.fn().mockRejectedValue(boom),
      });
      const events = makeEvents();
      const svc = new SettingsService(repo, events);

      await expect(svc.update('org_1', dto, 'user_actor')).rejects.toBe(boom);
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('emits a payload that satisfies SettingsUpdatedEventSchema (typed contract)', async () => {
      // R-Settings-Updated-Event + design §7: the payload shape is the
      // contract the future MVP-12 scheduler subscribes to. We round-
      // trip through the canonical schema so any drift in the type
      // export breaks this test loudly.
      const updatedAt = new Date('2026-04-29T10:30:00.000Z');
      const saved = makeSettingsRow({
        jurisdictions: dto.jurisdictions as unknown as Settings['jurisdictions'],
        scanSchedule: dto.scanSchedule,
        scanDay: dto.scanDay,
        scanHour: dto.scanHour,
        updatedAt,
      });
      const emit = vi.fn();
      const repo = makeRepo({ replace: vi.fn().mockResolvedValue(saved) });
      const events = { emit } as unknown as EventEmitter2;
      const svc = new SettingsService(repo, events);

      await svc.update('org_1', dto, 'user_actor');

      expect(emit).toHaveBeenCalledWith(SETTINGS_UPDATED_EVENT, expect.any(Object));
      const [, payload] = emit.mock.calls[0] ?? [];
      const parsed = SettingsUpdatedEventSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
      expect(parsed.data?.organizationId).toBe('org_1');
      expect(parsed.data?.actorId).toBe('user_actor');
      expect(parsed.data?.updatedAt).toBe(updatedAt.toISOString());
    });
  });

  describe('UpdateSettingsSchema cross-row invariants (validation contract)', () => {
    // R-Settings-Validation: the canonical schema rejects these four
    // shapes with the spec-mandated `error` codes. The service trusts
    // the parsed shape from `ZodBodyPipe` (B3); this parametrized
    // suite is the regression net for the contract.
    it.each([
      [
        'EMPTY_JURISDICTIONS',
        {
          jurisdictions: [],
          scanSchedule: 'weekly',
          scanDay: 'mon',
          scanHour: 8,
        },
      ],
      [
        'NO_ENABLED_JURISDICTION',
        {
          jurisdictions: [
            { code: 'MX', enabled: false, customTopics: '' },
            { code: 'CO', enabled: false, customTopics: '' },
          ],
          scanSchedule: 'weekly',
          scanDay: 'mon',
          scanHour: 8,
        },
      ],
      [
        'DUPLICATE_JURISDICTION_CODE',
        {
          jurisdictions: [
            { code: 'MX', enabled: true, customTopics: '' },
            { code: 'MX', enabled: false, customTopics: '' },
          ],
          scanSchedule: 'weekly',
          scanDay: 'mon',
          scanHour: 8,
        },
      ],
      [
        'WEEKLY_REQUIRES_SINGLE_DAY',
        {
          jurisdictions: [{ code: 'MX', enabled: true, customTopics: '' }],
          scanSchedule: 'weekly',
          scanDay: 'mon,tue',
          scanHour: 8,
        },
      ],
    ])('rejects %s', (expectedCode, input) => {
      const result = UpdateSettingsSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (result.success) return;
      const codes = result.error.issues.map((i) =>
        // For `z.array().min/refine` the user-visible code lives on
        // `error` (Zod 4); for `superRefine` `addIssue({code:'custom',
        // message})` the code travels on `message`.
        typeof i.message === 'string' ? i.message : '',
      );
      expect(codes).toContain(expectedCode);
    });
  });
});
