/**
 * DigestRepository — data access for the weekly digest feature.
 *
 * sdd/digest-export (POST-3) — task 2.1/2.2.
 *
 * Queries Alert rows in a time window for a given org. No mutation.
 * Implemented by PrismaDigestRepository; injected via DIGEST_REPO_TOKEN.
 * Foot-gun #667: always inject via @Inject(DIGEST_REPO_TOKEN).
 */

import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@regwatch/db/client';
import { PRISMA_CLIENT } from '../../common/prisma/prisma.token.js';

/** Minimal alert shape needed by the digest email. */
export interface DigestAlert {
  id: string;
  title: string;
  status: string;
  jurisdiction: string | null;
  detectedAt: Date;
}

export interface DigestRepository {
  /**
   * Returns all alerts for `orgId` where `detectedAt >= since`.
   * All statuses are included — digest shows the full 7-day picture.
   */
  findRecentAlerts(orgId: string, since: Date): Promise<DigestAlert[]>;
}

export const DIGEST_REPO_TOKEN = Symbol('DIGEST_REPO_TOKEN');

@Injectable()
export class PrismaDigestRepository implements DigestRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findRecentAlerts(orgId: string, since: Date): Promise<DigestAlert[]> {
    const rows = await this.prisma.alert.findMany({
      where: {
        organizationId: orgId,
        detectedAt: { gte: since },
      },
      select: {
        id: true,
        title: true,
        status: true,
        jurisdiction: true,
        detectedAt: true,
      },
      orderBy: { detectedAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      jurisdiction: r.jurisdiction,
      detectedAt: r.detectedAt,
    }));
  }
}
