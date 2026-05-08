/**
 * DI tokens for `NotificationsModule`.
 *
 * Symbol-based tokens required under tsx + NestJS DI (foot-gun #667):
 * `tsx` (esbuild) does NOT emit `design:paramtypes` metadata.
 */
export const NOTIFICATIONS_PRISMA_TOKEN = Symbol('NOTIFICATIONS_PRISMA_TOKEN');
export const NOTIFICATION_PORT_TOKEN = Symbol('NOTIFICATION_PORT_TOKEN');
export const NOTIFICATIONS_REPO_TOKEN = Symbol('NOTIFICATIONS_REPO_TOKEN');
