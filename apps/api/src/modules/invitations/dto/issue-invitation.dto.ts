import { z } from 'zod';

/**
 * Body schema for `POST /org/:orgId/invitations` (B5).
 *
 * Spec: `sdd/org-invitations/spec` R-Invitation-Issue.
 * Design: `sdd/org-invitations/design` §4 (DTO loose validation).
 *
 * Loose-on-purpose: the DTO accepts any non-empty string for `email`
 * and `role`. The service performs the canonical validation and emits
 * structured `INVALID_EMAIL` / `INVALID_ROLE` codes per spec — `ZodBodyPipe`
 * surfaces a generic 400 with `{message, issues}` and NO `code` field, so
 * pushing the format/role checks down into the service is the only way
 * to hold the spec contract for `code: 'INVALID_EMAIL' | 'INVALID_ROLE'`.
 *
 * The schema's job here is purely "is this JSON object remotely shaped
 * like the request?" — strings, present, non-empty. Everything else
 * (RFC-shaped email, role enum membership, OWNER-vs-ADMIN authorization,
 * personal-org guard, ALREADY_MEMBER) belongs to `InvitationsService.issue`.
 */
export const issueInvitationSchema = z
  .object({
    email: z.string().min(1),
    role: z.string().min(1),
  })
  .strict();

export type IssueInvitationDto = z.infer<typeof issueInvitationSchema>;
