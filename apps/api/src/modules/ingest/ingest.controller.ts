/**
 * IngestController — `POST /ingest/manual`.
 *
 * sdd/manual-ingestion R-1 / R-2 / R-3 / R-4 / R-5 / R-6.
 *
 * Guard chain (standard for scoped endpoints):
 *   JwtAuthGuard (global APP_GUARD) → MembershipFreshnessGuard (global) →
 *   OrgScopeGuard (global) → RolesGuard (global, enforces @Roles).
 *
 * @Roles('OWNER','ADMIN','ANALYST') — VIEWER → 403.
 * organizationId is read from `request.membership` (set by OrgScopeGuard),
 * NEVER from the request body (R-5 / invariant).
 *
 * Input dispatch:
 *   - If a `file` is present (multipart) → PDF path.
 *   - Otherwise → parse body with `ingestManualSchema` and dispatch on `type`.
 *
 * Foot-gun #667: constructor uses explicit @Inject(IngestService).
 */

import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  PayloadTooLargeException,
  Post,
  ServiceUnavailableException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentOrg } from '../../common/auth/decorators/current-org.decorator.js';
import { Roles } from '../../common/auth/decorators/roles.decorator.js';
import { ingestManualSchema, pdfMetaSchema } from './dto/ingest-manual.dto.js';
import { IngestService, DuplicateAlertError, SsrfBlockedError } from './ingest.service.js';
import { PdfExtractionError, MAX_PDF_BYTES } from './utils/pdf-extractor.js';
import { INGEST_ENV_TOKEN } from './tokens.js';
import type { ApiEnv } from '@regwatch/config';

interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

@Controller('ingest')
export class IngestController {
  constructor(
    @Inject(IngestService) private readonly service: IngestService,
    @Inject(INGEST_ENV_TOKEN) private readonly env: ApiEnv,
  ) {}

  /**
   * `POST /ingest/manual` — create an Alert from a URL, PDF, or pasted text.
   *
   * Returns 201 `{ alertId, message }` on success.
   * Returns 409 `{ alertId, message }` on dedup conflict.
   */
  @Post('manual')
  @Roles('OWNER', 'ADMIN', 'ANALYST')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async ingestManual(
    @UploadedFile() file: MulterFile | undefined,
    @Body() rawBody: unknown,
    @CurrentOrg() organizationId: string,
  ): Promise<{ alertId: string; message: string }> {
    // Feature flag — ADR-7.
    if (this.env.MANUAL_INGEST_ENABLED !== 'true') {
      throw new ServiceUnavailableException('Manual ingestion is currently disabled');
    }

    try {
      // PDF path — file present.
      if (file) {
        if (file.size > MAX_PDF_BYTES) {
          throw new PayloadTooLargeException(
            `PDF exceeds the ${MAX_PDF_BYTES / 1024 / 1024} MB limit`,
          );
        }

        const metaResult = pdfMetaSchema.safeParse(rawBody);
        if (!metaResult.success) {
          throw new BadRequestException({
            message: 'Validation failed',
            issues: metaResult.error.issues,
          });
        }

        const { alertId } = await this.service.ingestPdf(
          file.buffer,
          file.originalname,
          metaResult.data,
          organizationId,
        );
        return { alertId, message: 'Alert created and queued for enrichment' };
      }

      // URL / text path — parse body.
      const bodyResult = ingestManualSchema.safeParse(rawBody);
      if (!bodyResult.success) {
        throw new BadRequestException({
          message: 'Validation failed',
          issues: bodyResult.error.issues,
        });
      }

      const dto = bodyResult.data;

      if (dto.type === 'url') {
        const { alertId } = await this.service.ingestUrl(dto, organizationId);
        return { alertId, message: 'Alert created and queued for enrichment' };
      }

      if (dto.type === 'text') {
        const { alertId } = await this.service.ingestText(dto, organizationId);
        return { alertId, message: 'Alert created and queued for enrichment' };
      }

      // Exhaustive check — TypeScript narrowing makes this unreachable.
      throw new InternalServerErrorException('Unknown ingest type');
    } catch (err) {
      if (err instanceof DuplicateAlertError) {
        // Return 409 with the existing alertId.
        // We throw so NestJS maps to the correct HTTP status via a filter,
        // but NestJS doesn't have a 409 exception natively for the body shape
        // we need — so we re-throw a plain object and let the default filter handle it.
        // Simplest approach: use HttpException directly.
        const { HttpException } = await import('@nestjs/common');
        throw new HttpException(
          { alertId: err.existingAlertId, message: 'Alert already exists' },
          HttpStatus.CONFLICT,
        );
      }

      if (err instanceof SsrfBlockedError) {
        throw new BadRequestException(err.message);
      }

      if (err instanceof PdfExtractionError) {
        const { UnprocessableEntityException } = await import('@nestjs/common');
        throw new UnprocessableEntityException(err.message);
      }

      // Re-throw NestJS HTTP exceptions and unknown errors unchanged.
      throw err;
    }
  }
}
