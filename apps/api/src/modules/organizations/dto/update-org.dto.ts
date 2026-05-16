import { z } from 'zod';

/**
 * Body schema for `PATCH /org/:orgId` (onboarding-redesign).
 *
 * Mirrors `create-org.dto.ts` validation rules but lives in a separate
 * file because the intent and guard chain differ: create is `@PublicScope`
 * (no X-Org-Id required); rename is `@OrgScope` + OWNER-only.
 *
 * Spec: `sdd/onboarding-redesign/spec` — R-RenameOrg.
 * Design: `sdd/onboarding-redesign/design` — update-org.dto.ts (Create).
 */
export const updateOrgSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export type UpdateOrgDto = z.infer<typeof updateOrgSchema>;
