import { z } from 'zod';
import { createEnv as createCoreEnv } from '@t3-oss/env-core';
import { createEnv as createNextEnv } from '@t3-oss/env-nextjs';

/**
 * Reusable zod fragments. Each app composes the subset it needs.
 * Spec: bootstrap-monorepo § packages/config — zod env validator.
 */
export const fragments = {
  databaseUrl: z.string().url().startsWith('postgresql://'),
  port: z.coerce.number().int().positive().default(3000),
  jwtSecret: z.string().min(32),
  publicApiUrl: z.string().url(),
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
} as const;

export { createCoreEnv, createNextEnv, z };
