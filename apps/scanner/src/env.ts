import { createApiEnv } from '@regwatch/config';

/**
 * apps/scanner env contract.
 * Spec: auth-foundation § config — scanner is api-side; uses the api+core slice.
 * Spec: bootstrap-monorepo § packages/config — fail-fast on missing env.
 */
export const env = createApiEnv();
