import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
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

  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('RegWatch API')
      .setDescription('API interna de RegWatch — alertas regulatorias LatAm')
      .setVersion('1.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Org-Id' }, 'X-Org-Id')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(env.PORT);
}

void bootstrap();
