/**
 * `InternalSecretGuard` — validates the `X-Internal-Secret` header for
 * scanner-internal endpoints (`POST /enrich/trigger`).
 *
 * ADR-8: shared-secret auth over network-only trust.
 * - If `SCANNER_INTERNAL_SECRET` env is not set → `InternalServerErrorException`
 *   (misconfiguration, not a client error — alerts ops, not callers).
 * - If header is missing or mismatches → throws `UnauthorizedException` (→ 401).
 * - Comparison uses `crypto.timingSafeEqual` on SHA-256 digests to prevent
 *   timing attacks regardless of secret length differences.
 *
 * Stateless — no DI dependencies; registered as a plain provider in
 * `EnrichmentModule` and applied via `@UseGuards(InternalSecretGuard)`.
 *
 * Foot-gun #667: no constructor args → no `@Inject()` needed here.
 *
 * Spec: sdd/manual-ingestion/spec ADR-8.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

@Injectable()
export class InternalSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const secret = process.env['SCANNER_INTERNAL_SECRET'];
    if (!secret) {
      throw new InternalServerErrorException(
        'SCANNER_INTERNAL_SECRET is not configured. Set it in apps/scanner/.env.',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-internal-secret'];
    const headerValue = Array.isArray(header) ? header[0] : header;

    if (!headerValue) {
      throw new UnauthorizedException('Missing X-Internal-Secret header');
    }

    // timingSafeEqual requires same-length buffers — compare SHA-256 digests (always 32 bytes).
    const expected = sha256(secret);
    const received = sha256(headerValue);

    if (!timingSafeEqual(expected, received)) {
      throw new UnauthorizedException('Invalid X-Internal-Secret header');
    }

    return true;
  }
}
