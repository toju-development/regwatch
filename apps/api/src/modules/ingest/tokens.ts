/**
 * DI tokens for `IngestModule`.
 *
 * Explicit Symbol-based tokens are mandatory under tsx + NestJS DI
 * (foot-gun #667): the `tsx` (esbuild) transformer does NOT emit
 * `design:paramtypes` metadata.
 */
export const INGEST_PRISMA_TOKEN = Symbol('INGEST_PRISMA_TOKEN');
export const INGEST_ENV_TOKEN = Symbol('INGEST_ENV_TOKEN');
