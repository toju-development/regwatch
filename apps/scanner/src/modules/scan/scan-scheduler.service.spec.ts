/**
 * Unit tests for `ScanSchedulerService.runTick`.
 *
 * Spec: sdd/scanner-vertical-ar/spec R-7.
 * Design: sdd/scanner-vertical-ar/design ADR-3 + ADR-4.
 *
 * Validates:
 *  - orgs without Settings are skipped (no lazy-create).
 *  - cadence filter (`shouldScanNow`) gates dispatch.
 *  - dispatched runScan calls are fire-and-forget (rejection logged, not thrown).
 *  - prisma.findMany failure does NOT throw out of the tick.
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@regwatch/db/client';

import { ScanSchedulerService } from './scan-scheduler.service.js';
import type { ScanService } from './scan.service.js';

interface OrgRow {
  id: string;
  settings: { scanSchedule: string; scanDay: string; scanHour: number } | null;
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

function makeScan(impl?: (orgId: string) => Promise<unknown>) {
  const runScan = vi.fn(impl ?? (() => Promise.resolve({})));
  return { scan: { runScan } as unknown as ScanService, runScan };
}

// Wednesday 2026-04-29 08:00 UTC.
const WED_08 = new Date('2026-04-29T08:00:00Z');
const WED_09 = new Date('2026-04-29T09:00:00Z');

describe('ScanSchedulerService.runTick', () => {
  it('dispatches runScan(orgId) only for orgs whose cadence matches now', async () => {
    const orgs: OrgRow[] = [
      { id: 'org-daily-08', settings: { scanSchedule: 'daily', scanDay: 'mon', scanHour: 8 } },
      { id: 'org-daily-09', settings: { scanSchedule: 'daily', scanDay: 'mon', scanHour: 9 } },
      {
        id: 'org-weekly-wed-08',
        settings: { scanSchedule: 'weekly', scanDay: 'wed', scanHour: 8 },
      },
      {
        id: 'org-weekly-mon-08',
        settings: { scanSchedule: 'weekly', scanDay: 'mon', scanHour: 8 },
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
  });

  it('skips orgs without a Settings row (no lazy-create here)', async () => {
    const orgs: OrgRow[] = [
      { id: 'org-no-settings', settings: null },
      { id: 'org-with-settings', settings: { scanSchedule: 'daily', scanDay: 'mon', scanHour: 8 } },
    ];
    const { prisma } = makePrisma(orgs);
    const { scan, runScan } = makeScan();

    const svc = new ScanSchedulerService(prisma, scan);
    await svc.runTick(WED_08);

    expect(runScan).toHaveBeenCalledTimes(1);
    expect(runScan).toHaveBeenCalledWith('org-with-settings');
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
      { id: 'org-1', settings: { scanSchedule: 'daily', scanDay: 'mon', scanHour: 8 } },
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
      { id: 'org-1', settings: { scanSchedule: 'daily', scanDay: 'mon', scanHour: 8 } },
    ];
    const { prisma } = makePrisma(orgs);
    const { scan, runScan } = makeScan();

    const svc = new ScanSchedulerService(prisma, scan);
    await svc.runTick(WED_09); // hour gate fails (08 !== 09)

    expect(runScan).not.toHaveBeenCalled();
  });
});
