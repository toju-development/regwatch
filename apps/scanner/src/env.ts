import { createCoreEnv, fragments } from '@regwatch/config';

/**
 * apps/scanner env contract.
 * Spec: bootstrap-monorepo § packages/config — fail-fast on missing env.
 */
export const env = createCoreEnv({
  server: {
    PORT: fragments.port,
    DATABASE_URL: fragments.databaseUrl,
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
