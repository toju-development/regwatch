/**
 * DTOs for notification channel management.
 *
 * sdd/segmented-distribution/spec — CreateChannelDto replaces UpsertChannelDto:
 *   POST is now a pure create (no upsert); unique constraint dropped in migration #14.
 *   `jurisdictions` is an optional string array (default []); empty = catch-all.
 *
 * sdd/notify-slack/spec R "Channel CRUD Endpoints" — original CRUD contracts.
 *
 * sdd/notify-email-resend (POST-2) — task 3.1:
 *   superRefine validates webhookUrl format based on provider:
 *   - EMAIL → must be a valid email address (z.string().email())
 *   - SLACK, TEAMS → must be a valid URL (z.string().url())
 */
import { z } from 'zod';
import { NotificationProvider } from '@regwatch/db/client';

export const createChannelSchema = z
  .object({
    provider: z.nativeEnum(NotificationProvider),
    webhookUrl: z.string().min(1),
    channelName: z.string().optional(),
    jurisdictions: z.array(z.string()).default([]),
  })
  .superRefine((val, ctx) => {
    if (val.provider === 'EMAIL') {
      const result = z.string().email().safeParse(val.webhookUrl);
      if (!result.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['webhookUrl'],
          message: 'webhookUrl must be a valid email address for EMAIL provider',
        });
      }
    } else {
      // SLACK, TEAMS — validate as URL
      const result = z.string().url().safeParse(val.webhookUrl);
      if (!result.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['webhookUrl'],
          message: `webhookUrl must be a valid URL for ${val.provider} provider`,
        });
      }
    }
  });

export type CreateChannelDto = z.infer<typeof createChannelSchema>;

export const patchChannelSchema = z.object({
  webhookUrl: z.string().url().optional(),
  channelName: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  jurisdictions: z.array(z.string()).optional(),
});

export type PatchChannelDto = z.infer<typeof patchChannelSchema>;
