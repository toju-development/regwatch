/**
 * Unit tests for `NotificationAdapterRegistry`.
 *
 * sdd/notify-teams (POST-1):
 *  - 8.5 get('SLACK') returns the SlackAdapter mock
 *  - 8.5 get('TEAMS') returns the TeamsAdapter mock
 *  - 8.5 get('UNKNOWN') returns undefined
 *
 * NO `pnpm build` after changes (project rule).
 */

import { describe, it, expect, vi } from 'vitest';
import { NotificationAdapterRegistry } from '../notification-adapter.registry.js';
import type { NotificationPort } from '@regwatch/types';

function makeAdapter(name: string): NotificationPort {
  return {
    sendAlertConcluded: vi.fn().mockResolvedValue(undefined),
    sendAlertStatusChanged: vi.fn().mockResolvedValue(undefined),
    sendAlertAssigned: vi.fn().mockResolvedValue(undefined),
    _name: name, // for identity assertion
  } as unknown as NotificationPort;
}

describe('NotificationAdapterRegistry', () => {
  const slackAdapter = makeAdapter('slack');
  const teamsAdapter = makeAdapter('teams');

  // Bypass NestJS DI — inject directly via constructor
  const registry = new (NotificationAdapterRegistry as unknown as new (
    slack: NotificationPort,
    teams: NotificationPort,
  ) => NotificationAdapterRegistry)(slackAdapter, teamsAdapter);

  it('8.5: get("SLACK") returns the SlackAdapter instance', () => {
    expect(registry.get('SLACK')).toBe(slackAdapter);
  });

  it('8.5: get("TEAMS") returns the TeamsAdapter instance', () => {
    expect(registry.get('TEAMS')).toBe(teamsAdapter);
  });

  it('8.5: get("UNKNOWN") returns undefined', () => {
    expect(registry.get('UNKNOWN')).toBeUndefined();
  });

  it('8.5: get("EMAIL") returns undefined (not registered)', () => {
    expect(registry.get('EMAIL')).toBeUndefined();
  });
});
