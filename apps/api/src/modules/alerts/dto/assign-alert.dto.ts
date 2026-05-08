/**
 * DTO for `PATCH /alerts/:id/assignee`.
 * sdd/alert-collaboration/spec R "Assignment Invariant INV-COLLAB-1".
 */
import { z } from 'zod';

export const assignAlertSchema = z.object({
  assigneeId: z.string().nullable(),
});

export type AssignAlertDto = z.infer<typeof assignAlertSchema>;
