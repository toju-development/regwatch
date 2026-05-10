import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';
import { fragments } from './env.js';
import { createCoreEnv } from './core.js';

/**
 * API env slice — apps/api (NestJS) and apps/scanner.
 *
 * Composes core only (auth verification needs AUTH_SECRET from core);
 * adds runtime PORT for the Nest HTTP listener. Web-only auth keys are
 * intentionally absent to satisfy spec scenario "API loads only api+core slice".
 *
 * sdd/manual-ingestion ADR-7: SCANNER_INTERNAL_URL + MANUAL_INGEST_ENABLED
 * feature flag. ADR-8: SCANNER_INTERNAL_SECRET shared secret.
 *
 * @param runtimeEnv override for tests; defaults to `process.env` at call time.
 */
export function createApiEnv(runtimeEnv: Record<string, string | undefined> = process.env) {
  return createEnv({
    extends: [createCoreEnv(runtimeEnv)],
    server: {
      PORT: fragments.port,
      MEMBERSHIPS_FRESHNESS_TTL_MS: fragments.membershipsFreshnessTtlMs,
      /** Base URL of apps/scanner's HTTP listener. Default: localhost:3002. */
      SCANNER_INTERNAL_URL: z.string().url().default('http://localhost:3002'),
      /**
       * Shared secret sent as `X-Internal-Secret` header to apps/scanner.
       * Required in production; no default. Validated by InternalSecretGuard.
       */
      SCANNER_INTERNAL_SECRET: z.string().min(1),
      /**
       * Feature flag — set to 'true' to enable the manual ingestion endpoint.
       * Default 'false' so it can be rolled out gradually without redeploy.
       * Stored as a string and compared at runtime to avoid boolean coercion
       * inconsistencies across env var sources.
       */
      MANUAL_INGEST_ENABLED: z.string().default('false'),
      /**
       * Public base URL of the web app — used by `NotificationsListenerService`
       * to construct deep-link alert URLs in Slack messages.
       * Default: `http://localhost:3000` (local dev). Override in production.
       */
      APP_URL: z.string().url().default('http://localhost:3000'),
      /**
       * Feature flag — set to true to enable the email inbound endpoint.
       * Default false so it can be rolled out without a redeploy.
       * sdd/email-inbound REQ-2.
       */
      EMAIL_INBOUND_ENABLED: z.coerce.boolean().default(false),
      /**
       * ECDSA public key provided by SendGrid for webhook signature validation.
       * Required when EMAIL_INBOUND_ENABLED=true. Optional at config level so
       * the app boots without it (guard passthrough when unset — dev mode).
       * sdd/email-inbound REQ-1.
       */
      EMAIL_INBOUND_WEBHOOK_SECRET: z.string().optional(),
      /**
       * Email transport mode. 'memory' = in-process MemoryEmailAdapter (dev/test).
       * Any other value (or unset) → ResendEmailAdapter is used (production).
       * sdd/notify-email-resend (POST-2).
       */
      EMAIL_TRANSPORT: z.string().optional(),
      /**
       * Resend API key for outbound email. Required when EMAIL_TRANSPORT is not 'memory'.
       * Optional at config level so the memory adapter path can boot without it.
       * sdd/notify-email-resend (POST-2).
       */
      RESEND_API_KEY:
        runtimeEnv['EMAIL_TRANSPORT'] === 'memory' ? z.string().optional() : z.string().min(1),
      /**
       * Resend verified sender address (From: header). Required when not memory transport.
       * sdd/notify-email-resend (POST-2).
       */
      RESEND_FROM_EMAIL:
        runtimeEnv['EMAIL_TRANSPORT'] === 'memory'
          ? z.string().email().optional()
          : z.string().email(),
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
    // Build-time bypass: aligns the api slice with core/web. The Nest
    // build itself doesn't import env, but keeping the flag uniform avoids
    // a foot-gun if a future SSR/ESM consumer pulls this slice in at
    // build time. Runtime still fail-fasts.
    skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  });
}

export type ApiEnv = ReturnType<typeof createApiEnv>;
