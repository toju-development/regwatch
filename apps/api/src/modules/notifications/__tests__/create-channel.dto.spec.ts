/**
 * Unit tests for `createChannelSchema` (DTO validation).
 *
 * sdd/notify-email-resend (POST-2) — task 7.2.
 *
 * Table-driven: EMAIL+valid email=pass, EMAIL+URL=fail,
 * SLACK+email=fail, SLACK+valid URL=pass, TEAMS+email=fail.
 *
 * NO `pnpm build` after changes (project rule).
 */

import { describe, it, expect } from 'vitest';
import { createChannelSchema } from '../dto/create-channel.dto.js';

describe('createChannelSchema — provider-aware webhookUrl validation', () => {
  const cases: Array<{
    label: string;
    input: { provider: string; webhookUrl: string };
    shouldPass: boolean;
  }> = [
    {
      label: 'EMAIL + valid email → pass',
      input: { provider: 'EMAIL', webhookUrl: 'alerts@company.com' },
      shouldPass: true,
    },
    {
      label: 'EMAIL + URL → fail',
      input: { provider: 'EMAIL', webhookUrl: 'https://hooks.slack.com/services/test' },
      shouldPass: false,
    },
    {
      label: 'SLACK + valid URL → pass',
      input: { provider: 'SLACK', webhookUrl: 'https://hooks.slack.com/services/test' },
      shouldPass: true,
    },
    {
      label: 'SLACK + email → fail',
      input: { provider: 'SLACK', webhookUrl: 'user@company.com' },
      shouldPass: false,
    },
    {
      label: 'TEAMS + valid URL → pass',
      input: { provider: 'TEAMS', webhookUrl: 'https://outlook.office.com/webhook/test' },
      shouldPass: true,
    },
    {
      label: 'TEAMS + email → fail',
      input: { provider: 'TEAMS', webhookUrl: 'user@company.com' },
      shouldPass: false,
    },
  ];

  for (const tc of cases) {
    it(tc.label, () => {
      const result = createChannelSchema.safeParse({
        ...tc.input,
        channelName: 'test',
        jurisdictions: [],
      });

      if (tc.shouldPass) {
        expect(result.success).toBe(true);
      } else {
        expect(result.success).toBe(false);
        if (!result.success) {
          // Zod 4 uses `.issues`; fall back to `.errors` for older versions
          const issues =
            (
              result.error as {
                issues?: Array<{ path: string[] }>;
                errors?: Array<{ path: string[] }>;
              }
            ).issues ??
            (result.error as { errors?: Array<{ path: string[] }> }).errors ??
            [];
          const paths = issues.map((e) => e.path.join('.'));
          expect(paths).toContain('webhookUrl');
        }
      }
    });
  }
});
