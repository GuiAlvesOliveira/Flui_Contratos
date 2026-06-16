import * as appInsights from 'applicationinsights';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  // Application Insights — only when wired in the environment (prod). Started
  // before the app is created so requests/dependencies are instrumented (OBS-01).
  if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
    appInsights.setup().start();
  }

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
    origin: process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL
      : /^http:\/\/localhost:\d+$/,
  });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
