import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { env } from './env.js';

async function bootstrap(): Promise<void> {
  if (env.SENTRY_DSN) {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
    });
  }

  // rawBody: true — required by SendGridWebhookGuard to verify ECDSA signatures.
  // NestJS exposes the raw Buffer on req.rawBody when this flag is set.
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(app.get(Logger));
  await app.listen(env.PORT);
}

void bootstrap();
