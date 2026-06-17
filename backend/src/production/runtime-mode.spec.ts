import {
  apiRuntime,
  parseWorkerRole,
  RUNTIME_MODE,
  workerRuntime,
  WORKER_ROLE,
} from './runtime-mode';

describe('runtime mode', () => {
  it('keeps API mode HTTP-only', () => {
    expect(apiRuntime()).toEqual({
      mode: RUNTIME_MODE.API,
      workerRole: null,
      exposesHttp: true,
    });
  });

  it.each([
    ['outbox', WORKER_ROLE.OUTBOX],
    ['AI', WORKER_ROLE.AI],
    [' automation ', WORKER_ROLE.AUTOMATION],
    [undefined, WORKER_ROLE.ALL],
  ])('parses worker role %s', (value, expected) => {
    expect(workerRuntime(value)).toEqual({
      mode: RUNTIME_MODE.WORKER,
      workerRole: expected,
      exposesHttp: false,
    });
  });

  it('rejects unknown worker roles', () => {
    expect(() => parseWorkerRole('unknown')).toThrow(
      'Worker inválido: UNKNOWN',
    );
  });
});
