import { z } from 'zod';

/**
 * Body schema for `PATCH /org/:orgId/members/:userId`.
 *
 * Validates `{ role }` is one of the canonical {@link Role} literals.
 * `MembersService.updateRole(...)` enforces the structural invariants
 * (self-promote, ADMIN→OWNER, last-OWNER) on top of this shape check.
 *
 * Spec: `sdd/org-members/spec` R-Membership-Update.
 * Design: `sdd/org-members/design` §2.
 */
export const updateMemberRoleSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'ANALYST', 'VIEWER']),
});

export type UpdateMemberRoleDto = z.infer<typeof updateMemberRoleSchema>;
