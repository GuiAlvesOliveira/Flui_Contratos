import './telemetry-init'; // must stay the first import (instrumentation)
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { corsOrigins } from './common/frontend-url';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // trust proxy so the rate-limiter sees the real client IP behind Azure's proxy.
  app.set('trust proxy', 1);
  // Security headers; CORP cross-origin lets the separate frontend origin read
  // document streams via CORS (SEC-04).
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({
    origin: corsOrigins(process.env.FRONTEND_URL, process.env.NODE_ENV),
  });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
