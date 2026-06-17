import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { createRequire } from 'node:module';
import { apiRuntime } from './production/runtime-mode';

interface ProxyAwareHttpServer {
  set(setting: 'trust proxy', value: number): void;
}

export async function bootstrapApi() {
  const runtime = apiRuntime();
  process.env.RUNTIME_MODE = runtime.mode;
  const loadModule = createRequire(__filename);
  const { AppModule } = loadModule(
    './app.module',
  ) as typeof import('./app.module');
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });
  const configService = app.get(ConfigService);
  const trustProxyHops = Number.parseInt(
    configService.get<string>('TRUST_PROXY_HOPS', '0'),
    10,
  );

  if (trustProxyHops > 0) {
    const httpServer = app
      .getHttpAdapter()
      .getInstance() as ProxyAwareHttpServer;
    httpServer.set('trust proxy', trustProxyHops);
  }

  app.use(helmet());
  app.enableCors({
    origin: parseAllowedOrigins(
      configService.get<string>('CORS_ALLOWED_ORIGINS'),
    ),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    maxAge: 600,
  });
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = configService.get<string>('PORT', '3000');

  await app.listen(port, '0.0.0.0');

  Logger.log(`API runtime iniciado na porta ${port}`, 'Bootstrap');

  return app;
}

export function parseAllowedOrigins(value: string | undefined): string[] {
  const origins = (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error('CORS_ALLOWED_ORIGINS deve conter ao menos uma origem');
  }

  return origins;
}

if (require.main === module) {
  void bootstrapApi();
}
