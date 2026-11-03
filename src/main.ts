import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app.module.js';
import { parseAllowedOrigins, parsePort } from './platform/config.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
    rawBody: false,
    bufferLogs: true,
  });
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();

  const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'X-Request-ID'],
  });

  // Never emit request bodies, token headers, contact details or OTPs to logs.
  const port = parsePort(process.env.PORT);
  const host = process.env.HOST || '127.0.0.1';
  await app.listen(port, host);
}

bootstrap().catch((error: unknown) => {
  console.error('Services backend startup failed', error instanceof Error ? error.name : 'unknown');
  process.exitCode = 1;
});
