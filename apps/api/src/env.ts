import { createApiEnv } from '@regwatch/config';

/**
 * apps/api env contract.
 * Spec: auth-foundation § config — "API loads only api+core slice".
 * Spec: bootstrap-monorepo § packages/config — fail-fast on missing env.
 *
 * On schema failure, t3-env throws a ZodError before the HTTP listener binds.
 */
export const env = createApiEnv();
