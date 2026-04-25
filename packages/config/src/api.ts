import { createEnv } from '@t3-oss/env-core';
import { fragments } from './env.js';
import { createCoreEnv } from './core.js';

/**
 * API env slice — apps/api (NestJS) and apps/scanner.
 *
 * Composes core only (auth verification needs AUTH_SECRET from core);
 * adds runtime PORT for the Nest HTTP listener. Web-only auth keys are
 * intentionally absent to satisfy spec scenario "API loads only api+core slice".
 *
 * @param runtimeEnv override for tests; defaults to `process.env` at call time.
 */
export function createApiEnv(runtimeEnv: Record<string, string | undefined> = process.env) {
  return createEnv({
    extends: [createCoreEnv(runtimeEnv)],
    server: {
      PORT: fragments.port,
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
}

export type ApiEnv = ReturnType<typeof createApiEnv>;
