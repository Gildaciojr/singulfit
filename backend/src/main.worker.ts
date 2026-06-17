import { Logger } from '@nestjs/common';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createRequire } from 'node:module';
import { RUNTIME_MODE, workerRuntime } from './production/runtime-mode';

export async function bootstrapWorker(
  requestedRole = process.argv[2],
): Promise<INestApplicationContext> {
  const runtime = workerRuntime(requestedRole);
  const workerRole = runtime.workerRole;

  if (!workerRole) {
    throw new Error('Worker runtime sem papel configurado');
  }

  process.env.RUNTIME_MODE = RUNTIME_MODE.WORKER;
  process.env.WORKER_ROLE = workerRole;
  const loadModule = createRequire(__filename);
  const { WorkersModule } = loadModule(
    './workers/workers.module',
  ) as typeof import('./workers/workers.module');
  const app = await NestFactory.createApplicationContext(WorkersModule);

  app.enableShutdownHooks();
  Logger.log(`Worker runtime iniciado com papel ${workerRole}`, 'Bootstrap');

  return app;
}

if (require.main === module) {
  void bootstrapWorker();
}
