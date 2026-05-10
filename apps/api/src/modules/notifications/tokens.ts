/**
 * DI tokens for `NotificationsModule`.
 *
 * Symbol-based tokens required under tsx + NestJS DI (foot-gun #667):
 * `tsx` (esbuild) does NOT emit `design:paramtypes` metadata.
 */
export const NOTIFICATIONS_PRISMA_TOKEN = Symbol('NOTIFICATIONS_PRISMA_TOKEN');
/** @deprecated Use SLACK_ADAPTER_TOKEN. Will be removed in a follow-up cleanup. */
export const NOTIFICATION_PORT_TOKEN = Symbol('NOTIFICATION_PORT_TOKEN');
export const NOTIFICATIONS_REPO_TOKEN = Symbol('NOTIFICATIONS_REPO_TOKEN');

// ─── POST-1 (sdd/notify-teams): multi-provider adapter tokens ─────────────────

export const SLACK_ADAPTER_TOKEN = 'SLACK_ADAPTER_TOKEN';
export const TEAMS_ADAPTER_TOKEN = 'TEAMS_ADAPTER_TOKEN';
export const NOTIFICATION_ADAPTER_REGISTRY_TOKEN = 'NOTIFICATION_ADAPTER_REGISTRY_TOKEN';
