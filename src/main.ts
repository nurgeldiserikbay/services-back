import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app.module.js';
import { parseAllowedOrigins, parsePort } from './platform/config.js';
import {OtpDeliveryService} from './modules/guest-requests/otp-delivery.service.js';
import {assertGuestOtpHttpStartupReady} from './modules/guest-requests/otp-http-startup-gate.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
    // Capture exact signed JSON only in explicitly enabled deployments.
    rawBody: process.env.SERVICES_ENABLE_GUEST_CANCEL_HTTP === 'enabled',
    bufferLogs: true,
  });
  // Refuse to bind ANY socket when guest OTP HTTP is requested but the
  // application still uses DisabledOtpDelivery. Test-only Nest listeners may
  // inject a CI adapter independently; production startup must be explicit.
  assertGuestOtpHttpStartupReady(process.env,
    ()=>app.get(OtpDeliveryService,{strict:false}));
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
