/**
 * DTOs for notification channel management.
 *
 * sdd/segmented-distribution/spec — CreateChannelDto replaces UpsertChannelDto:
 *   POST is now a pure create (no upsert); unique constraint dropped in migration #14.
 *   `jurisdictions` is an optional string array (default []); empty = catch-all.
 *
 * sdd/notify-slack/spec R "Channel CRUD Endpoints" — original CRUD contracts.
 */
import { z } from 'zod';
import { NotificationProvider } from '@regwatch/db/client';

export const createChannelSchema = z.object({
  provider: z.nativeEnum(NotificationProvider),
  webhookUrl: z.string().url(),
  channelName: z.string().optional(),
  jurisdictions: z.array(z.string()).default([]),
});

export type CreateChannelDto = z.infer<typeof createChannelSchema>;

export const patchChannelSchema = z.object({
  webhookUrl: z.string().url().optional(),
  channelName: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  jurisdictions: z.array(z.string()).optional(),
});

export type PatchChannelDto = z.infer<typeof patchChannelSchema>;
