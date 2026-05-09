/**
 * DTO for `GET /alerts/stats` response.
 * sdd/dashboard-mvp/spec — api-alerts domain.
 */
import { z } from 'zod';

export const alertStatsDtoSchema = z.object({
  byStatus: z.record(z.string(), z.number()),
  bySeverity: z.record(z.string(), z.number()),
  total: z.number(),
});

export type AlertStatsDto = z.infer<typeof alertStatsDtoSchema>;
