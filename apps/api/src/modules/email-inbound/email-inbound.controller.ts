/**
 * EmailInboundController — `POST /inbound/email`.
 *
 * sdd/email-inbound REQ-1 (public endpoint, always 200).
 *
 * This endpoint is intentionally @Public() — SendGrid does not send a JWT.
 * Signature validation is handled by `SendGridWebhookGuard`.
 *
 * Error handling: ALL errors are caught and logged; the response is always
 * HTTP 200 `{ ok: true }` so SendGrid does not retry (retries on non-2xx).
 *
 * Foot-gun #667: explicit @Inject(EmailInboundService).
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator.js';
import { SendGridWebhookGuard } from './guards/sendgrid-webhook.guard.js';
import { EmailInboundService } from './email-inbound.service.js';
import { ParsedEmailDtoSchema } from './dto/parsed-email.dto.js';

@Controller()
export class EmailInboundController {
  private readonly logger = new Logger(EmailInboundController.name);

  constructor(@Inject(EmailInboundService) private readonly service: EmailInboundService) {}

  /**
   * `POST /inbound/email` — receive a SendGrid Inbound Parse webhook.
   *
   * Always returns HTTP 200 `{ ok: true }` regardless of outcome.
   * SendGrid retries on non-2xx — we must never return an error status.
   */
  @Post('inbound/email')
  @Public()
  @UseGuards(SendGridWebhookGuard)
  @HttpCode(HttpStatus.OK)
  async receive(@Body() rawBody: unknown): Promise<{ ok: true }> {
    try {
      const result = ParsedEmailDtoSchema.safeParse(rawBody);
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
