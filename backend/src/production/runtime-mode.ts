export const RUNTIME_MODE = {
  API: 'API',
  WORKER: 'WORKER',
} as const;

export type RuntimeMode = (typeof RUNTIME_MODE)[keyof typeof RUNTIME_MODE];

export const WORKER_ROLE = {
  ALL: 'ALL',
  OUTBOX: 'OUTBOX',
  AI: 'AI',
  AUTOMATION: 'AUTOMATION',
} as const;

export type WorkerRole = (typeof WORKER_ROLE)[keyof typeof WORKER_ROLE];

export interface RuntimeDescriptor {
  mode: RuntimeMode;
  workerRole: WorkerRole | null;
  exposesHttp: boolean;
}

export function apiRuntime(): RuntimeDescriptor {
  return {
    mode: RUNTIME_MODE.API,
    workerRole: null,
    exposesHttp: true,
  };
}

export function workerRuntime(value: string | undefined): RuntimeDescriptor {
  return {
    mode: RUNTIME_MODE.WORKER,
    workerRole: parseWorkerRole(value),
    exposesHttp: false,
  };
}

export function parseWorkerRole(value: string | undefined): WorkerRole {
  const role = value?.trim().toUpperCase() || WORKER_ROLE.ALL;

  if (!Object.values(WORKER_ROLE).includes(role as WorkerRole)) {
    throw new Error(`Worker inválido: ${role}`);
  }

  return role as WorkerRole;
}
