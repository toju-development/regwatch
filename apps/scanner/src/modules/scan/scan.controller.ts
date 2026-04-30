/**
 * MVP-5 manual scan trigger endpoint.
 *
 * `POST /scan/trigger` — body `{ organizationId }`. Fire-and-forget contract:
 * returns 202 + `{ scanLogId, status }` once `ScanService.runScan` resolves.
 * The mutex inside `runScan` collapses cron+manual races to ONE LLM call.
 *
 * DEPRECATED-IN-MVP-12: removed when scheduler-per-org + admin UI lands.
 *
 * Auth: `JwtAuthGuard` + `RolesGuard('OWNER','ADMIN')`. The scanner-local
 * `RolesGuard` extracts `organizationId` from the body and resolves the
 * caller's role from `request.user.memberships[]` (see roles.guard.ts
 * deviation header — OrgScopeGuard NOT copied).
 *
 * Spec: sdd/scanner-vertical-ar/spec R-8 (manual trigger), R-9 (auth).
 * Design: sdd/scanner-vertical-ar/design ADR-10.
 */
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Roles } from '../../common/auth/decorators/roles.decorator.js';
import { SCAN_SERVICE } from './tokens.js';
import type { ScanRunResult, ScanService } from './scan.service.js';

const TriggerBodySchema = z.object({
  organizationId: z.string().min(1),
});

export type TriggerBody = z.infer<typeof TriggerBodySchema>;

export interface TriggerResponse {
  scanLogId: string;
  status: ScanRunResult['status'];
}

@Controller('scan')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ScanController {
  constructor(@Inject(SCAN_SERVICE) private readonly scan: ScanService) {}

  /**
   * 202 Accepted — even though we await the inner promise, the contract is
   * "trigger accepted" semantics; UI polls `/usage/current` for completion.
   * SKIPPED_CAP_EXCEEDED is still a successful trigger (returned in body).
   */
  @Post('trigger')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles('OWNER', 'ADMIN')
  async trigger(@Body() body: unknown): Promise<TriggerResponse> {
    const parsed = TriggerBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join('; '));
    }

    const result = await this.scan.runScan(parsed.data.organizationId, 'AR');
    return { scanLogId: result.scanLogId, status: result.status };
  }
}
