/**
 * DTO for `PATCH /alerts/:id/conclusion`.
 * sdd/alert-collaboration/spec — conclusion is required before CONCLUDED transition.
 */
import { z } from 'zod';

export const concludeAlertSchema = z.object({
  conclusion: z.string().min(1),
});

export type ConcludeAlertDto = z.infer<typeof concludeAlertSchema>;
