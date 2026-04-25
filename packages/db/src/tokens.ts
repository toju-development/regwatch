import { randomBytes } from 'node:crypto';

/**
 * Deterministic invitation token reused by the dev seed.
 * Per design §10 — fixture only; real entropy is `generateInvitationToken()`.
 */
export const DEV_INVITATION_TOKEN = 'dev-invitation-token';

/**
 * Generate a cryptographically random, URL-safe invitation token.
 * 32 bytes of entropy → ~43 base64url characters (≤ 64 char DB cap).
 */
export function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}
