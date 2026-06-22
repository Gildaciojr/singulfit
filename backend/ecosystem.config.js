const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const logDirectory = path.join(root, 'logs');
fs.mkdirSync(logDirectory, { recursive: true });

const common = {
  cwd: root,
  autorestart: true,
  watch: false,
  instances: 1,
  exec_mode: 'fork',
  min_uptime: '10s',
  max_restarts: 10,
  restart_delay: 3000,
  exp_backoff_restart_delay: 100,
  kill_timeout: 30000,
  listen_timeout: 15000,
  merge_logs: true,
  time: true,
  env: {
    NODE_ENV: 'production',
  },
};

function logs(name) {
  return {
    out_file: path.join(logDirectory, `${name}-out.log`),
    error_file: path.join(logDirectory, `${name}-error.log`),
  };
}

module.exports = {
  apps: [
    {
      ...common,
      ...logs('api'),
      name: 'singulfit-api',
      script: 'dist/main.js',
      max_memory_restart: '512M',
      kill_timeout: 15000,
      env: {
        ...common.env,
        RUNTIME_MODE: 'API',
      },
    },
    {
      ...common,
      ...logs('worker-outbox'),
      name: 'singulfit-worker-outbox',
      script: 'dist/main.worker.js',
      args: 'outbox',
      max_memory_restart: '384M',
      env: {
        ...common.env,
        RUNTIME_MODE: 'WORKER',
        WORKER_ROLE: 'OUTBOX',
      },
    },
    {
      ...common,
      ...logs('worker-ai'),
      name: 'singulfit-worker-ai',
      script: 'dist/main.worker.js',
      args: 'ai',
      max_memory_restart: '768M',
      env: {
        ...common.env,
        RUNTIME_MODE: 'WORKER',
        WORKER_ROLE: 'AI',
      },
    },
    {
      ...common,
      ...logs('worker-automation'),
      name: 'singulfit-worker-automation',
      script: 'dist/main.worker.js',
      args: 'automation',
      max_memory_restart: '384M',
      env: {
        ...common.env,
        RUNTIME_MODE: 'WORKER',
        WORKER_ROLE: 'AUTOMATION',
      },
    },
  ],
};
