import { createCoreEnv, fragments } from '@regwatch/config';

/**
 * apps/api env contract.
 * Spec: bootstrap-monorepo § packages/config — "Missing required env aborts api boot".
 * On schema failure, t3-env throws a ZodError before HTTP listener binds.
 */
export const env = createCoreEnv({
  server: {
    PORT: fragments.port,
    DATABASE_URL: fragments.databaseUrl,
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
