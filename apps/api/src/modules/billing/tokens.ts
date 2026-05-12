/**
 * DI tokens for `BillingModule`.
 *
 * Explicit Symbol-based tokens are mandatory under tsx + NestJS DI
 * (foot-gun #667): the `tsx` (esbuild) transformer does NOT emit
 * `design:paramtypes` metadata.
 *
 * sdd/billing-stripe POST-9.
 */
export const STRIPE_CLIENT_TOKEN = Symbol('STRIPE_CLIENT_TOKEN');
export const BILLING_ENV_TOKEN = Symbol('BILLING_ENV_TOKEN');
export const BILLING_PRISMA_TOKEN = Symbol('BILLING_PRISMA_TOKEN');
