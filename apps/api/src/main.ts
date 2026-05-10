import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { env } from './env.js';

async function bootstrap(): Promise<void> {
  // rawBody: true — required by SendGridWebhookGuard to verify ECDSA signatures.
  // NestJS exposes the raw Buffer on req.rawBody when this flag is set.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  await app.listen(env.PORT);

  console.log(`[api] listening on :${env.PORT}`);
}

void bootstrap();
