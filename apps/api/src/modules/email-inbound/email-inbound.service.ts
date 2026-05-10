/**
 * EmailInboundService — business logic for the email inbound webhook.
 *
 * sdd/email-inbound REQ-2 (feature flag), REQ-3 (org resolution),
 * REQ-4 (alert creation + dedup), REQ-5 (enrichment trigger).
 *
 * Data flow:
 *   1. Check EMAIL_INBOUND_ENABLED flag → early return if false.
 *   2. Extract slug from envelope.to[0] (format: slug@inbound.regwatch.io).
 *   3. Lookup org by slug → return if not found (silent drop).
 *   4. Extract Message-ID from raw headers via regex.
 *   5. sourceUrl = 'email:' + messageId
 *   6. sourceUrlHash = computeSourceUrlHash(sourceUrl)
 *   7. body = strip HTML tags from dto.html, fall back to dto.text
 *   8. prisma.alert.upsert — silent dedup (update: {})
 *   9. fireTrigger fire-and-forget with 5s timeout
 *
 * Foot-gun #667: explicit @Inject tokens.
 */
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@regwatch/db/client';
import { computeSourceUrlHash } from '@regwatch/db/dedup';
import type { ApiEnv } from '@regwatch/config';
import type { ParsedEmailDto } from './dto/parsed-email.dto.js';
import { EMAIL_INBOUND_PRISMA_TOKEN, EMAIL_INBOUND_ENV_TOKEN } from './tokens.js';

/** Naive HTML tag stripper — enrichment reprocesses content, so this is good enough. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

@Injectable()
export class EmailInboundService {
  private readonly logger = new Logger(EmailInboundService.name);

  constructor(
    @Inject(EMAIL_INBOUND_PRISMA_TOKEN) private readonly prisma: PrismaClient,
    @Inject(EMAIL_INBOUND_ENV_TOKEN) private readonly env: ApiEnv,
  ) {}

  async handle(dto: ParsedEmailDto): Promise<void> {
    // REQ-2: feature flag check — early return if disabled.
    if (!this.env.EMAIL_INBOUND_ENABLED) {
      return;
    }

    // REQ-3: extract slug from envelope.to[0].
    let envelopeParsed: { to?: string[]; from?: string };
    try {
      envelopeParsed = JSON.parse(dto.envelope) as { to?: string[]; from?: string };
    } catch {
      this.logger.warn(`Failed to parse envelope JSON: ${dto.envelope}`);
      return;
    }

    const toAddress = envelopeParsed.to?.[0] ?? dto.to;
    const slug = toAddress.split('@')[0];
    if (!slug) {
      this.logger.warn(`Could not extract slug from to: ${toAddress}`);
      return;
    }

    // REQ-3: org lookup → silent drop if not found.
    const org = await this.prisma.organization.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!org) {
      this.logger.debug(`No org found for slug=${slug} — dropping inbound email`);
      return;
    }

    // REQ-4: Message-ID extraction from raw headers.
    const match = /^Message-ID:\s*<(.+?)>/im.exec(dto.headers);
    const messageId = match?.[1] ?? `fallback:${randomUUID()}`;

    const sourceUrl = `email:${messageId}`;
    const sourceUrlHash = computeSourceUrlHash(sourceUrl);

    // REQ-4: body — strip HTML or fall back to plain text.
    const body = (dto.html ? stripHtml(dto.html) : '') || dto.text || '';

    // REQ-4: upsert — silent dedup on (organizationId, sourceUrlHash) conflict.
    const alert = await this.prisma.alert.upsert({
      where: { organizationId_sourceUrlHash: { organizationId: org.id, sourceUrlHash } },
      create: {
        organizationId: org.id,
        source: 'EMAIL_INBOUND',
        sourceUrl,
        sourceUrlHash,
        title: dto.subject || '(no subject)',
        fullContent: body || null,
        status: 'NEW',
        enrichmentStatus: 'PENDING',
        jurisdiction: null,
      },
      update: {},
      select: { id: true },
    });

    // REQ-5: fire-and-forget enrichment trigger.
    this.fireTrigger(alert.id, org.id);
  }

  /**
   * Fire-and-forget POST to scanner's /enrich/trigger.
   * Logs WARN on failure; NEVER rethrows (sweeper fallback).
   * ADR-1: 5s timeout.
   */
  private fireTrigger(alertId: string, organizationId: string): void {
    const url = `${this.env.SCANNER_INTERNAL_URL}/enrich/trigger`;
    const secret = this.env.SCANNER_INTERNAL_SECRET;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);

    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify({ alertId, organizationId }),
      signal: controller.signal,
    })
      .then((res) => {
        clearTimeout(timer);
        if (!res.ok) {
          this.logger.warn(`scanner trigger returned HTTP ${res.status} for alertId=${alertId}`);
        }
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        this.logger.warn(
          `scanner trigger failed for alertId=${alertId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }
}
