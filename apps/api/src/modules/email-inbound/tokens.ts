/**
 * DI tokens for `EmailInboundModule`.
 *
 * Explicit Symbol-based tokens are mandatory under tsx + NestJS DI
 * (foot-gun #667): the `tsx` (esbuild) transformer does NOT emit
 * `design:paramtypes` metadata.
 */
export const EMAIL_INBOUND_PRISMA_TOKEN = Symbol('EMAIL_INBOUND_PRISMA_TOKEN');
export const EMAIL_INBOUND_ENV_TOKEN = Symbol('EMAIL_INBOUND_ENV_TOKEN');
