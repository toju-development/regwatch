import { describe, expect, it } from 'vitest';
import { DEV_INVITATION_TOKEN, generateInvitationToken } from '../src/tokens.js';

describe('tokens', () => {
  it('generateInvitationToken returns a base64url-safe string of >=43 chars', () => {
    const token = generateInvitationToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generateInvitationToken returns unique values across calls', () => {
    expect(generateInvitationToken()).not.toBe(generateInvitationToken());
  });

  it('exposes a deterministic dev seed token', () => {
    expect(DEV_INVITATION_TOKEN).toBe('dev-invitation-token');
  });
});
