/**
 * DTO for `POST /notifications/channels` (upsert).
 *
 * sdd/notify-slack/spec R "Channel CRUD Endpoints".
 * Idempotent on (organizationId, provider) — same request twice updates, not duplicates.
 */
import { z } from 'zod';
import { NotificationProvider } from '@regwatch/db/client';

export const upsertChannelSchema = z.object({
  provider: z.nativeEnum(NotificationProvider),
  webhookUrl: z.string().url(),
  channelName: z.string().optional(),
});

export type UpsertChannelDto = z.infer<typeof upsertChannelSchema>;

export const patchChannelSchema = z.object({
  webhookUrl: z.string().url().optional(),
  channelName: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export type PatchChannelDto = z.infer<typeof patchChannelSchema>;
