import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';
import { fragments } from './env.js';

/**
 * Core env slice — shared by every app (api, scanner, web).
 *
 * Spec: auth-foundation § config — "AUTH_SECRET in core" (≥32 chars),
 * "Optional JWT issuer/audience". Locked by design Q12.
 *
 * @param runtimeEnv override for tests; defaults to `process.env` at call time.
 */
export function createCoreEnv(runtimeEnv: Record<string, string | undefined> = process.env) {
  return createEnv({
    server: {
      DATABASE_URL: fragments.databaseUrl,
      NODE_ENV: fragments.nodeEnv,
      AUTH_SECRET: fragments.authSecret,
      JWT_ISSUER: z.string().min(1).optional(),
      JWT_AUDIENCE: z.string().min(1).optional(),
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
}

export type CoreEnv = ReturnType<typeof createCoreEnv>;
