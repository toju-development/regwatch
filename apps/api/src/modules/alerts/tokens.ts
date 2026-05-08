/**
 * DI tokens for `AlertsModule`.
 *
 * Symbol-based tokens required under tsx + NestJS DI (foot-gun #667):
 * `tsx` (esbuild) does NOT emit `design:paramtypes` metadata.
 */
export const ALERTS_PRISMA_TOKEN = Symbol('ALERTS_PRISMA_TOKEN');
export const ALERTS_ENV_TOKEN = Symbol('ALERTS_ENV_TOKEN');
export const ALERTS_REPO_TOKEN = Symbol('ALERTS_REPO_TOKEN');
