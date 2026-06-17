import { NestFactory } from '@nestjs/core';
import { bootstrapWorker } from './main.worker';
import { RUNTIME_MODE, WORKER_ROLE } from './production/runtime-mode';

describe('worker bootstrap', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.RUNTIME_MODE;
    delete process.env.WORKER_ROLE;
  });

  it('starts an application context without exposing HTTP', async () => {
    const applicationContext = {
      enableShutdownHooks: jest.fn(),
    };
    const createApplicationContext = jest
      .spyOn(NestFactory, 'createApplicationContext')
      .mockResolvedValue(applicationContext as never);

    const result = await bootstrapWorker('ai');

    expect(result).toBe(applicationContext);
    expect(process.env.RUNTIME_MODE).toBe(RUNTIME_MODE.WORKER);
    expect(process.env.WORKER_ROLE).toBe(WORKER_ROLE.AI);
    expect(createApplicationContext).toHaveBeenCalledTimes(1);
    expect(applicationContext.enableShutdownHooks).toHaveBeenCalledTimes(1);
  });
});
