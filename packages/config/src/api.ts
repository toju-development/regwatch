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
       * Sentry Data Source Name. When absent, Sentry is disabled gracefully.
       * sdd/observability (POST-6).
       */
      SENTRY_DSN: z.string().optional(),
      /**
       * Minimum log level emitted by nestjs-pino / pino-http.
       * Accepts pino level strings: trace, debug, info, warn, error, fatal.
       * Defaults to 'info' which suppresses debug noise in production.
       * sdd/observability (POST-6).
       */
      LOG_LEVEL: z.string().default('info'),
      /**
       * Resend API key for outbound email. Optional at config level; the
       * NotificationsModule validates its presence at runtime when the
       * email adapter is active.
       * sdd/notify-email-resend (POST-2).
       */
      RESEND_API_KEY: z.string().optional(),
      /**
       * Resend verified sender address (From: header). Optional at config level;
       * validated by NotificationsModule at runtime.
       * sdd/notify-email-resend (POST-2).
       */
      RESEND_FROM_EMAIL: z.string().email().optional(),
      /**
       * Stripe secret key (server-side only). Used by BillingService to
       * create Checkout sessions and validate webhooks.
       * sdd/billing-stripe (POST-9).
       */
      STRIPE_SECRET_KEY: z.string().min(1),
      /**
       * Stripe webhook signing secret. Used by BillingController to verify
       * that incoming webhook payloads originate from Stripe.
       * sdd/billing-stripe (POST-9).
       */
      STRIPE_WEBHOOK_SECRET: z.string().min(1),
      /**
       * Stripe Price ID for the Pro plan. Used when creating Checkout sessions.
       * sdd/billing-stripe (POST-9).
       */
      STRIPE_PRO_PRICE_ID: z.string().min(1),
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
