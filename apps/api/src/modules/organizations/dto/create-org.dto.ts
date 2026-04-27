import { z } from 'zod';

/**
 * Body schema for `POST /org` (`@PublicScope()` — JWT required).
 *
 * Spec: `sdd/org-membership-ux/spec` R-OrgCreate — body `{ name }`,
 * `name` trimmed, 1–80 chars, empty/oversize → 400.
 *
 * Design: `sdd/org-membership-ux/design` §2.
 */
export const createOrgSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export type CreateOrgDto = z.infer<typeof createOrgSchema>;
