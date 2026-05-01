/**
 * Unit tests for `ScanController.trigger`.
 *
 * Validates:
 *  - body validation (Zod): missing/blank organizationId → BadRequestException.
 *  - delegation: calls ScanService.runScan with the trusted body orgId + 'AR'.
 *  - response shape: { scanLogId, status }.
 *
 * Auth-guard wiring is exercised by `roles.guard.spec.ts` /
 * `jwt-auth.guard.spec.ts`; this file mocks the service only.
 *
 * Spec: sdd/scanner-vertical-ar/spec R-8.
 * Design: sdd/scanner-vertical-ar/design ADR-10.
 */
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ScanController } from './scan.controller.js';
import type { ScanRunResult, ScanService } from './scan.service.js';

function makeScan(result: ScanRunResult) {
  const runScan = vi.fn().mockResolvedValue(result);
  return { svc: { runScan } as unknown as ScanService, runScan };
}

describe('ScanController.trigger', () => {
  it('returns { scanLogId, status } for a valid body', async () => {
    const { svc, runScan } = makeScan({
      scanLogId: 'sl-1',
      status: 'COMPLETED',
      alertsFound: 3,
      tokensUsed: 10,
      costUsd: '0.000019',
      errorMsg: null,
    });
    const ctrl = new ScanController(svc);

    const res = await ctrl.trigger({ organizationId: 'org-trusted' });

    expect(res).toEqual({ scanLogId: 'sl-1', status: 'COMPLETED' });
    expect(runScan).toHaveBeenCalledWith('org-trusted', 'AR');
  });

  it('forwards the SKIPPED_CAP_EXCEEDED status from the service (still 202)', async () => {
    const { svc } = makeScan({
      scanLogId: 'sl-skip',
      status: 'SKIPPED_CAP_EXCEEDED',
      alertsFound: 0,
      tokensUsed: 0,
      costUsd: '0',
      errorMsg: 'monthly cap reached (10/10 USD)',
    });
    const ctrl = new ScanController(svc);

    const res = await ctrl.trigger({ organizationId: 'org-cap' });
    expect(res.status).toBe('SKIPPED_CAP_EXCEEDED');
  });

  it('throws BadRequestException when organizationId is missing', async () => {
    const { svc, runScan } = makeScan({
      scanLogId: 'x',
      status: 'COMPLETED',
      alertsFound: 0,
      tokensUsed: 0,
      costUsd: '0',
      errorMsg: null,
    });
    const ctrl = new ScanController(svc);

    await expect(ctrl.trigger({})).rejects.toBeInstanceOf(BadRequestException);
    expect(runScan).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when organizationId is empty string', async () => {
    const { svc, runScan } = makeScan({
      scanLogId: 'x',
      status: 'COMPLETED',
      alertsFound: 0,
      tokensUsed: 0,
      costUsd: '0',
      errorMsg: null,
    });
    const ctrl = new ScanController(svc);

    await expect(ctrl.trigger({ organizationId: '' })).rejects.toBeInstanceOf(BadRequestException);
    expect(runScan).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when organizationId is wrong type', async () => {
    const { svc, runScan } = makeScan({
      scanLogId: 'x',
      status: 'COMPLETED',
      alertsFound: 0,
      tokensUsed: 0,
      costUsd: '0',
      errorMsg: null,
    });
    const ctrl = new ScanController(svc);

    await expect(ctrl.trigger({ organizationId: 123 })).rejects.toBeInstanceOf(BadRequestException);
    expect(runScan).not.toHaveBeenCalled();
  });
});
