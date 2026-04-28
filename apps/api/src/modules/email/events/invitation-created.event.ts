import type { Role } from '@regwatch/types';

/**
 * Event payload for `invitation.created`.
 *
 * Spec: `sdd/org-invitations/spec` R-Invitation-Issue scenario "Issue
 *   happy path (new row + email enqueued)" — the listener MUST receive
 *   enough context to render the invitation email with the canonical
 *   accept URL.
 * Design: `sdd/org-invitations/design` D3 (EventEmitter2 post-commit
 *   orchestration), D4 (port shape), D10 (`/accept/[token]` page).
 *
 * Emitted by `InvitationsService.issue` (B4) AFTER `await tx` so the
 * listener never observes a pre-commit row. Consumed by `EmailListener`
 * (B2). Fire-and-forget: listener errors MUST NOT propagate.
 *
 * Field provenance:
 *   - `to`           — invitee email (already lowercased at write time).
 *   - `orgName`      — `Organization.name` for the inviting org.
 *   - `inviterName`  — `User.name` of the issuing OWNER/ADMIN (or `null`
 *                      when the user has not set a display name; the
 *                      template falls back to "A teammate").
 *   - `role`         — invitation role assigned to the invitee.
 *   - `acceptUrl`    — fully-qualified URL of the form
 *                      `${WEB_URL}/accept/${token}` (B4 builds it).
 *   - `expiresAt`    — `Invitation.expiresAt` instant (ISO renders in
 *                      the template).
 */
export const INVITATION_CREATED_EVENT = 'invitation.created' as const;

export interface InvitationCreatedEvent {
  to: string;
  orgName: string;
  inviterName: string | null;
  role: Role;
  acceptUrl: string;
  expiresAt: Date;
}
