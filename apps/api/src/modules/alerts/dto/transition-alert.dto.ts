/**
 * DTO for `PATCH /alerts/:id/status`.
 * sdd/alert-collaboration/spec R "Status Transition Guard".
 */
import { z } from 'zod';
import { ALERT_STATUS_VALUES } from '@regwatch/types';

export const transitionAlertSchema = z.object({
  status: z.enum(ALERT_STATUS_VALUES),
  note: z.string().optional(),
});

export type TransitionAlertDto = z.infer<typeof transitionAlertSchema>;
