/**
 * IngestService — orchestrates the three manual ingestion paths.
 *
 * sdd/manual-ingestion R-1 (URL), R-2 (PDF), R-3 (text), R-4 (dedup),
 * R-6 (enrichment trigger).
 *
 * Design:
 *  - All three paths: compute sourceUrlHash → INSERT Alert → fire-and-forget
 *    POST /enrich/trigger → return alertId.
 *  - Dedup: Prisma P2002 on `@@unique([organizationId, sourceUrlHash])` →
 *    throw `DuplicateAlertError` carrying the existing alert id.
 *  - Trigger: 5s timeout, X-Internal-Secret header. Failure → log WARN,
 *    NOT rethrow (sweeper fallback, ADR-1).
 *  - organizationId ALWAYS from auth (never from body) — R-5 / invariant.
 *
 * Foot-gun #667: all constructor args use @Inject(TOKEN).
 */

import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@regwatch/db/client';
import { computeSourceUrlHash, normalizeUrl } from '@regwatch/db/dedup';
import type { ApiEnv } from '@regwatch/config';
import { fetchUrl, SsrfBlockedError } from './utils/url-fetcher.js';
import { extractPdfText } from './utils/pdf-extractor.js';
import type { UrlIngestDto, TextIngestDto, PdfMetaDto } from './dto/ingest-manual.dto.js';
import { INGEST_PRISMA_TOKEN, INGEST_ENV_TOKEN } from './tokens.js';

export { SsrfBlockedError };

/** Prisma error code for a unique-constraint violation. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

function isP2002(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === PRISMA_UNIQUE_VIOLATION
  );
}

/** Returns the SHA-256 hex digest of a string or Buffer (UTF-8 encoding for strings). */
function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Thrown when an alert with the same `(organizationId, sourceUrlHash)` already
 * exists. Controller maps this to HTTP 409.
 */
export class DuplicateAlertError extends Error {
  constructor(public readonly existingAlertId: string) {
    super(`Alert already exists: ${existingAlertId}`);
    this.name = 'DuplicateAlertError';
  }
}

export interface IngestResult {
  alertId: string;
}

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    @Inject(INGEST_PRISMA_TOKEN) private readonly prisma: PrismaClient,
    @Inject(INGEST_ENV_TOKEN) private readonly env: ApiEnv,
  ) {}

  /**
   * Ingest a remote URL.
   *
   * @throws {@link SsrfBlockedError} if the URL is blocked by the SSRF guard.
   * @throws {@link DuplicateAlertError} if an alert with the same content hash exists.
   */
  async ingestUrl(dto: UrlIngestDto, organizationId: string): Promise<IngestResult> {
    const { url, jurisdiction, regulator, title: inputTitle } = dto;

    const { text, title: fetchedTitle } = await fetchUrl(url);
    const resolvedTitle = inputTitle ?? fetchedTitle ?? url;

    const sourceUrl = normalizeUrl(url);
    const sourceUrlHash = computeSourceUrlHash(sourceUrl);

    const alertId = await this.createAlert({
      organizationId,
      sourceUrl,
      sourceUrlHash,
      title: resolvedTitle,
      fullContent: text || null,
      jurisdiction,
      regulator: regulator ?? null,
    });

    this.fireTrigger(alertId, organizationId);

    return { alertId };
  }

  /**
   * Ingest a PDF upload.
   *
   * @throws {@link PdfExtractionError} if the PDF cannot be parsed or exceeds 10 MB.
   * @throws {@link DuplicateAlertError} if an alert with the same content hash exists.
   */
  async ingestPdf(
    buffer: Buffer,
    filename: string,
    dto: PdfMetaDto,
    organizationId: string,
  ): Promise<IngestResult> {
    const { jurisdiction, regulator, title: inputTitle } = dto;

    const text = await extractPdfText(buffer);
    const bufferHash = sha256Hex(buffer);
    const sourceUrl = `manual:pdf:${filename}`;
    const sourceUrlHash = computeSourceUrlHash(`manual:pdf:${bufferHash}`);
    const resolvedTitle = inputTitle ?? filename;

    const alertId = await this.createAlert({
      organizationId,
      sourceUrl,
      sourceUrlHash,
      title: resolvedTitle,
      fullContent: text || null,
      jurisdiction,
      regulator: regulator ?? null,
    });

    this.fireTrigger(alertId, organizationId);

    return { alertId };
  }

  /**
   * Ingest raw pasted text.
   *
   * @throws {@link DuplicateAlertError} if an alert with the same content hash exists.
   */
  async ingestText(dto: TextIngestDto, organizationId: string): Promise<IngestResult> {
    const { text, title, jurisdiction, regulator } = dto;

    const textHash = sha256Hex(Buffer.from(text, 'utf-8'));
    const slug = title.toLowerCase().replace(/\s+/g, '-').slice(0, 100);
    const sourceUrl = `manual:text:${slug}`;
    const sourceUrlHash = computeSourceUrlHash(`manual:text:${textHash}`);

    const alertId = await this.createAlert({
      organizationId,
      sourceUrl,
      sourceUrlHash,
      title,
      fullContent: text,
      jurisdiction,
      regulator: regulator ?? null,
    });

    this.fireTrigger(alertId, organizationId);

    return { alertId };
  }

  // ------------------------------------------------------------------ //
  // Private helpers                                                      //
  // ------------------------------------------------------------------ //

  /**
   * Create an Alert row. On P2002 (dedup conflict), query for the existing
   * alert and throw {@link DuplicateAlertError}.
   */
  private async createAlert(params: {
    organizationId: string;
    sourceUrl: string;
    sourceUrlHash: string;
    title: string;
    fullContent: string | null;
    jurisdiction: string;
    regulator: string | null;
  }): Promise<string> {
    const {
      organizationId,
      sourceUrl,
      sourceUrlHash,
      title,
      fullContent,
      jurisdiction,
      regulator,
    } = params;

    try {
      const alert = await this.prisma.alert.create({
        data: {
          organizationId,
          source: 'MANUAL',
          sourceUrl,
          sourceUrlHash,
          title,
          fullContent,
          jurisdiction,
          regulator,
          status: 'NEW',
          enrichmentStatus: 'PENDING',
        },
        select: { id: true },
      });
      return alert.id;
    } catch (err) {
      if (isP2002(err)) {
        const existing = await this.prisma.alert.findFirst({
          where: { organizationId, sourceUrlHash },
          select: { id: true },
        });
        throw new DuplicateAlertError(existing?.id ?? 'unknown');
      }
      throw err;
    }
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
