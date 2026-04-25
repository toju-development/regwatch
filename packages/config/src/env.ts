import { z } from 'zod';
import { createEnv as createNextEnv } from '@t3-oss/env-nextjs';

/**
 * Reusable zod fragments. Each app composes the subset it needs.
 * Spec: bootstrap-monorepo § packages/config — zod env validator.
 * Spec: auth-foundation § config — `authSecret` (≥32 chars) added in MVP-3a.
 */
export const fragments = {
  databaseUrl: z.string().url().startsWith('postgresql://'),
  port: z.coerce.number().int().positive().default(3000),
  jwtSecret: z.string().min(32),
  authSecret: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  publicApiUrl: z.string().url(),
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
} as const;

export { createNextEnv, z };
