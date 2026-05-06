/**
 * `EnrichmentController` — exposes `POST /enrich/trigger` for API→Scanner
 * fire-and-forget enrichment calls (manual ingest flow, MVP-7).
 *
 * Auth: `InternalSecretGuard` validates `X-Internal-Secret` header (ADR-8).
 * Body: `{ alertId: string, organizationId: string }` — validated with Zod.
 * Response: `202 { accepted: true, alertId }`.
 *
 * Fire-and-forget contract: we call `enrichmentService.enrichAlert(...)` without
 * awaiting its completion. The caller gets 202 immediately; enrichment runs async.
 * The sweeper provides a fallback if the trigger fails.
 *
 * Foot-gun #667 (tsx + NestJS DI): constructor arg uses explicit
 * `@Inject(ENRICHMENT_SERVICE)` token — typed-class injection is unreliable.
 *
 * Spec: sdd/manual-ingestion/spec B3. Design: ADR-1, ADR-8.
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

import { ENRICHMENT_SERVICE } from './tokens.js';
import type { EnrichmentService } from './enrichment.service.js';
import { InternalSecretGuard } from './guards/internal-secret.guard.js';

const TriggerBodySchema = z.object({
  alertId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type EnrichTriggerBody = z.infer<typeof TriggerBodySchema>;

export interface EnrichTriggerResponse {
  accepted: true;
  alertId: string;
}

@Controller('enrich')
export class EnrichmentController {
  constructor(@Inject(ENRICHMENT_SERVICE) private readonly enrichmentService: EnrichmentService) {}

  /**
   * 202 Accepted — confirms the enrichment trigger was received.
   * `enrichAlert` runs fire-and-forget; caller should not wait for completion.
   */
  @Post('trigger')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(InternalSecretGuard)
  trigger(@Body() body: unknown): EnrichTriggerResponse {
    const parsed = TriggerBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join('; '));
    }

    const { alertId, organizationId } = parsed.data;

    // Fire-and-forget — do NOT await. Sweeper retries if this fails.
    void this.enrichmentService.enrichAlert(alertId, organizationId);

    return { accepted: true, alertId };
  }
}
