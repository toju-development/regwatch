/**
 * SendGridWebhookGuard — validates SendGrid ECDSA webhook signatures.
 *
 * sdd/email-inbound REQ-1 (signature validation).
 *
 * Algorithm: verify `X-Twilio-Email-Event-Webhook-Signature` (base64 DER)
 * over the concatenation of `X-Twilio-Email-Event-Webhook-Timestamp` + raw
 * request body using ECDSA/SHA-256 with the public key stored in
 * `EMAIL_INBOUND_WEBHOOK_SECRET`.
 *
 * Guard bypass: when `EMAIL_INBOUND_WEBHOOK_SECRET` is not set, `canActivate`
 * returns `true` (dev mode). This matches the design decision: guard decorators
 * are static; passthrough-when-unconfigured is idiomatic for dev mode.
 *
 * Foot-gun #667: explicit @Inject(EMAIL_INBOUND_ENV_TOKEN).
 */
import { createVerify } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import type { ApiEnv } from '@regwatch/config';
import { EMAIL_INBOUND_ENV_TOKEN } from '../tokens.js';

@Injectable()
export class SendGridWebhookGuard implements CanActivate {
  private readonly logger = new Logger(SendGridWebhookGuard.name);

  constructor(@Inject(EMAIL_INBOUND_ENV_TOKEN) private readonly env: ApiEnv) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.env.EMAIL_INBOUND_WEBHOOK_SECRET;

    // Dev mode: no secret configured → passthrough.
    if (!secret) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const signature = request.headers['x-twilio-email-event-webhook-signature'] as
      | string
      | undefined;
    const timestamp = request.headers['x-twilio-email-event-webhook-timestamp'] as
      | string
      | undefined;

    if (!signature || !timestamp) {
      throw new ForbiddenException('Missing SendGrid webhook signature headers');
    }

    const rawBody = (request as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);

    try {
      const verifier = createVerify('SHA256');
      verifier.update(timestamp);
      verifier.update(rawBody);
      const valid = verifier.verify(secret, signature, 'base64');
      if (!valid) {
        throw new ForbiddenException('Invalid SendGrid webhook signature');
      }
      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      this.logger.warn(
        `ECDSA verification error: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ForbiddenException('Webhook signature verification failed');
    }
  }
}
