/**
 * EmailInboundController — `POST /inbound/email`.
 *
 * sdd/email-inbound REQ-1 (public endpoint, always 200).
 *
 * This endpoint is intentionally @Public() — SendGrid does not send a JWT.
 * Signature validation is performed inline via `SendGridWebhookGuard.verify()`.
 * Failures are absorbed (log + return { ok: true }) to preserve the always-200
 * contract — SendGrid retries on non-2xx.
 *
 * Multipart: SendGrid posts `multipart/form-data`. `AnyFilesInterceptor()` from
 * `@nestjs/platform-express` runs multer, which populates `req.body` with the
 * parsed fields (to, from, subject, text, html, headers, envelope, …).
 *
 * rawBody: NestFactory is created with `{ rawBody: true }` so `req.rawBody`
 * holds the raw Buffer needed for ECDSA signature verification.
 *
 * Foot-gun #667: explicit @Inject tokens.
 */
import {
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { Public } from '../../common/auth/public.decorator.js';
import { SendGridWebhookGuard } from './guards/sendgrid-webhook.guard.js';
import { EmailInboundService } from './email-inbound.service.js';
import { ParsedEmailDtoSchema } from './dto/parsed-email.dto.js';

@Controller()
export class EmailInboundController {
  private readonly logger = new Logger(EmailInboundController.name);

  constructor(
    @Inject(EmailInboundService) private readonly service: EmailInboundService,
    @Inject(SendGridWebhookGuard) private readonly guard: SendGridWebhookGuard,
  ) {}

  /**
   * `POST /inbound/email` — receive a SendGrid Inbound Parse webhook.
   *
   * Always returns HTTP 200 `{ ok: true }` regardless of outcome.
   * SendGrid retries on non-2xx — we must never return an error status.
   */
  @Post('inbound/email')
  @Public()
  @UseInterceptors(AnyFilesInterceptor())
  @HttpCode(HttpStatus.OK)
  async receive(@Req() req: Request): Promise<{ ok: true }> {
    try {
      // Inline signature verification — absorb failure, never throw.
      if (!this.guard.verify(req)) {
        this.logger.warn('Invalid SendGrid webhook signature — dropping silently');
        return { ok: true };
      }

      const result = ParsedEmailDtoSchema.safeParse(req.body);
      if (!result.success) {
        this.logger.warn(`Invalid inbound email payload: ${JSON.stringify(result.error.issues)}`);
        return { ok: true };
      }
      await this.service.handle(result.data);
    } catch (err) {
      this.logger.error(
        `Unhandled error processing inbound email: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { ok: true };
  }
}
