/**
 * DigestService — business logic for the weekly digest email.
 *
 * sdd/digest-export (POST-3) — task 4.1–4.5.
 *
 * For each org call:
 *  1. Fetch recent alerts via DigestRepository
 *  2. Fetch OWNER members via MembersRepo
 *  3. Skip if no alerts or no owners
 *  4. Group alerts by jurisdiction (null → "Unclassified")
 *  5. Render digestWeeklyTemplate
 *  6. Send one email per owner via EMAIL_PORT (Promise.allSettled — never throws)
 *
 * Foot-gun #667: inject via Symbol tokens.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { MEMBERS_REPO_TOKEN, type MembersRepo } from '../members/members.repo.js';
import { EMAIL_PORT, type EmailPort } from '../email/email.port.js';
import { DIGEST_REPO_TOKEN, type DigestRepository } from './digest.repository.js';
import { digestWeeklyTemplate, type DigestGroup } from './templates/digest-weekly.template.js';

@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    @Inject(DIGEST_REPO_TOKEN) private readonly digestRepo: DigestRepository,
    @Inject(MEMBERS_REPO_TOKEN) private readonly membersRepo: MembersRepo,
    @Inject(EMAIL_PORT) private readonly emailPort: EmailPort,
  ) {}

  /**
   * Builds and sends the weekly digest for one organization.
   * Returns silently if skipped (0 alerts or 0 OWNER recipients).
   */
  async buildAndSend(
    orgId: string,
    orgName: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<void> {
    const [alerts, members] = await Promise.all([
      this.digestRepo.findRecentAlerts(orgId, windowStart),
      this.membersRepo.listByOrg(orgId),
    ]);

    if (alerts.length === 0) {
      this.logger.debug(`[digest] org=${orgId} skipped — 0 alerts in window`);
      return;
    }

    const owners = members.filter((m) => m.role === 'OWNER');
    if (owners.length === 0) {
      this.logger.debug(`[digest] org=${orgId} skipped — 0 OWNER members`);
      return;
    }

    // Group by jurisdiction; null → "Unclassified"
    const groupMap = new Map<string, typeof alerts>();
    for (const alert of alerts) {
      const key = alert.jurisdiction ?? 'Unclassified';
      const existing = groupMap.get(key);
      if (existing) {
        existing.push(alert);
      } else {
        groupMap.set(key, [alert]);
      }
    }
    const groups: DigestGroup[] = Array.from(groupMap.entries()).map(
      ([jurisdiction, grpAlerts]) => ({
        jurisdiction,
        alerts: grpAlerts,
      }),
    );

    const template = digestWeeklyTemplate({ orgName, windowStart, windowEnd, groups });

    const results = await Promise.allSettled(
      owners.map((owner) =>
        this.emailPort.send({
          to: owner.email,
          subject: template.subject,
          html: template.html,
          text: template.text,
          tags: { type: 'digest', orgId },
        }),
      ),
    );

    for (const [i, result] of results.entries()) {
      if (result.status === 'rejected') {
        this.logger.error(
          `[digest] org=${orgId} failed to send to ${owners[i]?.email}: ${String(result.reason)}`,
        );
      }
    }

    this.logger.log(
      `[digest] org=${orgId} sent to ${results.filter((r) => r.status === 'fulfilled').length}/${owners.length} owners`,
    );
  }
}
