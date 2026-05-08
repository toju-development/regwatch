/**
 * DTO for `GET /alerts` query parameters.
 * sdd/alert-collaboration/spec R "Alert List Filters".
 */
import { z } from 'zod';
import { ALERT_STATUS_VALUES } from '@regwatch/types';

export const listAlertsSchema = z.object({
  status: z
    .preprocess(
      (v) => {
        if (Array.isArray(v))
          return v
            .flatMap((s) =>
              String(s)
                .split(',')
                .map((x) => x.trim()),
            )
            .filter(Boolean);
        if (typeof v === 'string')
          return v
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean);
        return v;
      },
      z.array(z.enum(ALERT_STATUS_VALUES)).optional(),
    )
    .optional(),
  assigneeId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListAlertsDto = z.infer<typeof listAlertsSchema>;
