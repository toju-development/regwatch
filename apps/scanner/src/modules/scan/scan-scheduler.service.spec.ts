/**
 * Unit tests for `ScanSchedulerService.runTick`.
 *
 * Spec: sdd/scanner-vertical-ar/spec R-7;
 *       sdd/scheduler-per-org/spec R-Scheduler-*.
 * Design: sdd/scanner-vertical-ar/design ADR-3 + ADR-4;
 *         sdd/scheduler-per-org/design.
 *
 * Validates:
 *  - orgs without Settings are skipped (no lazy-create).
 *  - cadence filter (`shouldScanNow`) gates dispatch.
 *  - dispatched runScan calls are fire-and-forget (rejection logged, not thrown).
 *  - prisma.findMany failure does NOT throw out of the tick.
 *  - orgs with empty jurisdictions → logger.warn + no dispatch.
 *  - unsupported jurisdictions → logger.warn + no dispatch for that jurisdiction.
 *  - supported jurisdictions dispatched with correct (orgId, jurisdiction) args.
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@regwatch/db/client';

import { ScanSchedulerService } from './scan-scheduler.service.js';
import type { ScanService } from './scan.service.js';

interface OrgRow {
  id: string;
  settings: {
    scanSchedule: string;
    scanDay: string;
    scanDayOfMonth?: number | null;
    scanHour: number;
    jurisdictions: unknown;
  } | null;
}

function makePrisma(orgs: OrgRow[] | Error) {
  const findMany = vi.fn(() =>
    orgs instanceof Error ? Promise.reject(orgs) : Promise.resolve(orgs),
  );
  return {
    prisma: { organization: { findMany } } as unknown as PrismaClient,
    findMany,
  };
}

function makeScan(impl?: (orgId: string, jurisdiction: string) => Promise<unknown>) {
  const runScan = vi.fn(impl ?? (() => Promise.resolve({})));
  return { scan: { runScan } as unknown as ScanService, runScan };
}

// Wednesday 2026-04-29 08:00 UTC.
const WED_08 = new Date('2026-04-29T08:00:00Z');
const WED_09 = new Date('2026-04-29T09:00:00Z');

// AR jurisdiction in the canonical JSONB shape (SettingsJurisdictionsSchema).
const AR_JURISDICTIONS = JSON.stringify([{ code: 'AR', enabled: true, customTopics: [] }]);

describe('ScanSchedulerService.runTick', () => {
  it('dispatches runScan(orgId, jurisdiction) only for orgs whose cadence matches now', async () => {
    const orgs: OrgRow[] = [
      {
        id: 'org-daily-08',
        settings: {
          scanSchedule: 'daily',
          scanDay: 'mon',
          scanHour: 8,
          jurisdictions: AR_JURISDICTIONS,
        },
      },
      {
        id: 'org-daily-09',
        settings: {
          scanSchedule: 'daily',
          scanDay: 'mon',
          scanHour: 9,
          jurisdictions: AR_JURISDICTIONS,
        },
      },
      {
        id: 'org-weekly-wed-08',
        settings: {
          scanSchedule: 'weekly',
          scanDay: 'wed',
          scanHour: 8,
          jurisdictions: AR_JURISDICTIONS,
        },
      },
      {
        id: 'org-weekly-mon-08',
        settings: {
          scanSchedule: 'weekly',
          scanDay: 'mon',
          scanHour: 8,
          jurisdictions: AR_JURISDICTIONS,
        },
      },
    ];
    const { prisma } = makePrisma(orgs);
    const { scan, runScan } = makeScan();

    const svc = new ScanSchedulerService(prisma, scan);
    await svc.runTick(WED_08);

    const dispatched = runScan.mock.calls.map((c) => c[0]);
    expect(dispatched).toEqual(expect.arrayContaining(['org-daily-08', 'org-weekly-wed-08']));
    expect(dispatched).not.toContain('org-daily-09');
    expect(dispatched).not.toContain('org-weekly-mon-08');
    expect(runScan).toHaveBeenCalledTimes(2);
    expect(runScan).toHaveBeenCalledWith('org-daily-08', 'AR');
    expect(runScan).toHaveBeenCalledWith('org-weekly-wed-08', 'AR');
  });

  it('skips orgs without a Settings row (no lazy-create here)', async () => {
    const orgs: OrgRow[] = [
      { id: 'org-no-settings', settings: null },
      {
        id: 'org-with-settings',
        settings: {
          scanSchedule: 'daily',
          scanDay: 'mon',
          scanHour: 8,
          jurisdictions: AR_JURISDICTIONS,
        },
      },
    ];
    const { prisma } = makePrisma(orgs);
    const { scan, runScan } = makeScan();

    const svc = new ScanSchedulerService(prisma, scan);
    await svc.runTick(WED_08);

    expect(runScan).toHaveBeenCalledTimes(1);
    expect(runScan).toHaveBeenCalledWith('org-with-settings', 'AR');
  });

  it('does NOT throw when prisma.findMany rejects (logged, swallowed)', async () => {
    const { prisma } = makePrisma(new Error('db down'));
    const { scan, runScan } = makeScan();

    const svc = new ScanSchedulerService(prisma, scan);
    await expect(svc.runTick(WED_08)).resolves.toBeUndefined();
    expect(runScan).not.toHaveBeenCalled();
  });

  it('does NOT throw when an individual runScan rejects (fire-and-forget)', async () => {
    const orgs: OrgRow[] = [
      {
        id: 'org-1',
        settings: {
          scanSchedule: 'daily',
          scanDay: 'mon',
          scanHour: 8,
          jurisdictions: AR_JURISDICTIONS,
        },
      },
    ];
    const { prisma } = makePrisma(orgs);
    const { scan, runScan } = makeScan(() => Promise.reject(new Error('LLM 500')));

    const svc = new ScanSchedulerService(prisma, scan);
    await expect(svc.runTick(WED_08)).resolves.toBeUndefined();
    expect(runScan).toHaveBeenCalledTimes(1);
    // Let the catch handler attached to the rejected promise run so unhandled
    // rejection warnings do not leak to other tests.
    await new Promise((r) => setImmediate(r));
  });

  it('dispatches nothing when no orgs match cadence', async () => {
    const orgs: OrgRow[] = [
      {
        id: 'org-1',
        settings: {
          scanSchedule: 'daily',
          scanDay: 'mon',
          scanHour: 8,
          jurisdictions: AR_JURISDICTIONS,
        },
      },
    ];
    const { prisma } = makePrisma(orgs);
    const { scan, runScan } = makeScan();

    const svc = new ScanSchedulerService(prisma, scan);
    await svc.runTick(WED_09); // hour gate fails (08 !== 09)

    expect(runScan).not.toHaveBeenCalled();
  });

  it('skips org with empty jurisdictions and emits logger.warn', async () => {
    const orgs: OrgRow[] = [
      {
        id: 'org-empty-jur',
        settings: {
          scanSchedule: 'daily',
          scanDay: 'mon',
          scanHour: 8,
          jurisdictions: JSON.stringify([]),
        },
      },
    ];
    const { prisma } = makePrisma(orgs);
    const { scan, runScan } = makeScan();

    const svc = new ScanSchedulerService(prisma, scan);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const warnSpy = vi.spyOn((svc as any).logger, 'warn');
    await svc.runTick(WED_08);

    expect(runScan).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('org-empty-jur'));
  });

  it('dispatches AR and MX (both now supported in POST-10)', async () => {
    const orgs: OrgRow[] = [
      {
        id: 'org-ar-mx',
        settings: {
          scanSchedule: 'daily',
          scanDay: 'mon',
          scanHour: 8,
          jurisdictions: JSON.stringify([
            { code: 'AR', enabled: true, customTopics: [] },
            { code: 'MX', enabled: true, customTopics: [] },
          ]),
        },
      },
    ];
    const { prisma } = makePrisma(orgs);
    const { scan, runScan } = makeScan();

    const svc = new ScanSchedulerService(prisma, scan);
    await svc.runTick(WED_08);

    expect(runScan).toHaveBeenCalledTimes(2);
    expect(runScan).toHaveBeenCalledWith('org-ar-mx', 'AR');
    expect(runScan).toHaveBeenCalledWith('org-ar-mx', 'MX');
  });

  it('dispatches once per supported jurisdiction when cadence matches', async () => {
    const orgs: OrgRow[] = [
      {
        id: 'org-ar',
        settings: {
          scanSchedule: 'daily',
          scanDay: 'mon',
          scanHour: 8,
          jurisdictions: JSON.stringify([{ code: 'AR', enabled: true, customTopics: [] }]),
        },
      },
    ];
    const { prisma } = makePrisma(orgs);
    const { scan, runScan } = makeScan();

    const svc = new ScanSchedulerService(prisma, scan);
    await svc.runTick(WED_08);

    expect(runScan).toHaveBeenCalledTimes(1);
    expect(runScan).toHaveBeenCalledWith('org-ar', 'AR');
  });

  it('skips jurisdictions with enabled: false — does not dispatch', async () => {
    const orgs: OrgRow[] = [
      {
        id: 'org-disabled-ar',
        settings: {
          scanSchedule: 'daily',
          scanDay: 'mon',
          scanHour: 8,
          jurisdictions: JSON.stringify([
            { code: 'AR', enabled: false, customTopics: [] },
            { code: 'MX', enabled: false, customTopics: [] },
          ]),
        },
      },
    ];
    const { prisma } = makePrisma(orgs);
    const { scan, runScan } = makeScan();

    const svc = new ScanSchedulerService(prisma, scan);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const warnSpy = vi.spyOn((svc as any).logger, 'warn');
    await svc.runTick(WED_08);

    // All jurisdictions disabled → normalizes to empty → skipped with warn.
    expect(runScan).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('org-disabled-ar'));
  });
});
