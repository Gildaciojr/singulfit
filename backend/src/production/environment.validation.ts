import { isAbsolute } from 'node:path';
import {
  RUNTIME_MODE,
  RuntimeMode,
  WorkerRole,
  WORKER_ROLE,
} from './runtime-mode';

type Environment = Record<string, unknown>;

interface IntegerRule {
  key: string;
  fallback?: number;
  min: number;
  max: number;
}

const REQUIRED_PRODUCTION_KEYS = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_ISSUER',
  'JWT_AUDIENCE',
  'CORS_ALLOWED_ORIGINS',
  'PAGBANK_API_URL',
  'PAGBANK_TOKEN',
  'PAGBANK_WEBHOOK_SECRET',
  'EVOLUTION_BASE_URL',
  'EVOLUTION_API_KEY',
  'EVOLUTION_INSTANCE_NAME',
  'EVOLUTION_WEBHOOK_SECRET',
  'OPENAI_API_KEY',
  'OPENAI_MODEL_TEXT',
  'OPENAI_MODEL_VISION',
  'UPLOAD_PATH',
  'OPENAI_TEXT_INPUT_COST_PER_1M_USD',
  'OPENAI_TEXT_OUTPUT_COST_PER_1M_USD',
  'OPENAI_VISION_INPUT_COST_PER_1M_USD',
  'OPENAI_VISION_OUTPUT_COST_PER_1M_USD',
  'ANALYTICS_USD_TO_BRL_RATE',
  'ANALYTICS_WHATSAPP_INBOUND_COST_BRL',
  'ANALYTICS_WHATSAPP_RESPONSE_COST_BRL',
  'ANALYTICS_WHATSAPP_AUTOMATION_COST_BRL',
  'ANALYTICS_STORAGE_GB_MONTH_COST_BRL',
] as const;

const SECRET_KEYS = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'PAGBANK_TOKEN',
  'PAGBANK_WEBHOOK_SECRET',
  'EVOLUTION_API_KEY',
  'EVOLUTION_WEBHOOK_SECRET',
  'OPENAI_API_KEY',
] as const;

const DECIMAL_KEYS = [
  'OPENAI_TEXT_INPUT_COST_PER_1M_USD',
  'OPENAI_TEXT_OUTPUT_COST_PER_1M_USD',
  'OPENAI_VISION_INPUT_COST_PER_1M_USD',
  'OPENAI_VISION_OUTPUT_COST_PER_1M_USD',
  'ANALYTICS_USD_TO_BRL_RATE',
  'ANALYTICS_WHATSAPP_INBOUND_COST_BRL',
  'ANALYTICS_WHATSAPP_RESPONSE_COST_BRL',
  'ANALYTICS_WHATSAPP_AUTOMATION_COST_BRL',
  'ANALYTICS_STORAGE_GB_MONTH_COST_BRL',
] as const;

const INTEGER_RULES: IntegerRule[] = [
  { key: 'PORT', fallback: 3000, min: 1, max: 65_535 },
  { key: 'TRUST_PROXY_HOPS', fallback: 0, min: 0, max: 10 },
  { key: 'BASIC_DAILY_IMAGE_LIMIT', fallback: 5, min: 0, max: 1_000_000 },
  {
    key: 'PREMIUM_DAILY_IMAGE_LIMIT',
    fallback: 999_999,
    min: 0,
    max: 1_000_000,
  },
  {
    key: 'SUBSCRIPTION_GRACE_PERIOD_DAYS',
    fallback: 3,
    min: 0,
    max: 30,
  },
  { key: 'WEBHOOK_LEASE_SECONDS', fallback: 60, min: 10, max: 3_600 },
  { key: 'WEBHOOK_MAX_ATTEMPTS', fallback: 10, min: 1, max: 100 },
  { key: 'WORKER_POLL_MS', fallback: 1_000, min: 250, max: 60_000 },
  { key: 'OUTBOX_WORKER_POLL_MS', fallback: 1_000, min: 250, max: 60_000 },
  { key: 'AI_WORKER_POLL_MS', fallback: 1_000, min: 250, max: 60_000 },
  {
    key: 'AUTOMATION_WORKER_POLL_MS',
    fallback: 1_000,
    min: 250,
    max: 60_000,
  },
  { key: 'WORKER_STALE_SECONDS', fallback: 60, min: 10, max: 3_600 },
  { key: 'OUTBOX_BATCH_SIZE', fallback: 20, min: 1, max: 100 },
  { key: 'OUTBOX_LEASE_SECONDS', fallback: 120, min: 30, max: 3_600 },
  { key: 'OUTBOX_MAX_ATTEMPTS', fallback: 10, min: 1, max: 100 },
  { key: 'OUTBOX_RETRY_BASE_MS', fallback: 1_000, min: 100, max: 3_600_000 },
  {
    key: 'OUTBOX_RETRY_MAX_MS',
    fallback: 300_000,
    min: 100,
    max: 86_400_000,
  },
  {
    key: 'OUTBOX_BACKLOG_WARNING_MINUTES',
    fallback: 10,
    min: 1,
    max: 1_440,
  },
  { key: 'OUTBOX_RETENTION_DAYS', fallback: 30, min: 1, max: 3_650 },
  { key: 'WEBHOOK_RETENTION_DAYS', fallback: 90, min: 1, max: 3_650 },
  {
    key: 'SYSTEM_EVENT_RETENTION_DAYS',
    fallback: 90,
    min: 1,
    max: 3_650,
  },
  { key: 'AUDIT_RETENTION_DAYS', fallback: 365, min: 1, max: 3_650 },
  {
    key: 'RETENTION_CLEANUP_INTERVAL_MS',
    fallback: 3_600_000,
    min: 60_000,
    max: 86_400_000,
  },
  {
    key: 'RETENTION_CLEANUP_BATCH_SIZE',
    fallback: 1_000,
    min: 10,
    max: 10_000,
  },
  {
    key: 'AI_JOB_LEASE_SECONDS',
    fallback: 120,
    min: 30,
    max: 3_600,
  },
  {
    key: 'AI_RESERVATION_TTL_SECONDS',
    fallback: 300,
    min: 30,
    max: 86_400,
  },
  {
    key: 'AI_RECOVERY_INTERVAL_MS',
    fallback: 30_000,
    min: 1_000,
    max: 3_600_000,
  },
  {
    key: 'EVOLUTION_INBOUND_LEASE_SECONDS',
    fallback: 120,
    min: 30,
    max: 3_600,
  },
  {
    key: 'EVOLUTION_INBOUND_POLL_MS',
    fallback: 1_000,
    min: 250,
    max: 60_000,
  },
  {
    key: 'EVOLUTION_RECOVERY_INTERVAL_MS',
    fallback: 30_000,
    min: 1_000,
    max: 3_600_000,
  },
  {
    key: 'EVOLUTION_SEND_LEASE_SECONDS',
    fallback: 60,
    min: 10,
    max: 3_600,
  },
  { key: 'MAX_IMAGE_SIZE_MB', fallback: 10, min: 1, max: 500 },
  { key: 'MAX_AUDIO_SIZE_MB', fallback: 25, min: 1, max: 500 },
  { key: 'MAX_DOCUMENT_SIZE_MB', fallback: 25, min: 1, max: 500 },
];

export function validateEnvironment(
  environment: Environment,
  mode: RuntimeMode,
): Environment {
  const issues = collectEnvironmentIssues(environment, mode);

  if (issues.length > 0) {
    throw new Error(
      `Configuração de ambiente inválida:\n- ${issues.join('\n- ')}`,
    );
  }

  return environment;
}

export function collectEnvironmentIssues(
  environment: Environment,
  mode: RuntimeMode,
): string[] {
  const issues: string[] = [];
  const production = text(environment.NODE_ENV) === 'production';

  if (production) {
    for (const key of REQUIRED_PRODUCTION_KEYS) {
      if (!text(environment[key])) {
        issues.push(`${key} é obrigatória em produção`);
      }
    }

    for (const { key } of INTEGER_RULES) {
      if (!text(environment[key])) {
        issues.push(`${key} é obrigatória em produção`);
      }
    }
  }

  validateDatabaseUrl(environment, issues, production);
  validateProviderUrl(environment, 'PAGBANK_API_URL', issues, production);
  validateProviderUrl(environment, 'EVOLUTION_BASE_URL', issues, production);
  validateCors(environment, issues, production);
  validateSecrets(environment, issues, production);
  validateDecimals(environment, issues, production);
  validateIntegers(environment, issues);
  validateStorage(environment, issues, production);
  validateRuntime(environment, mode, issues);

  return issues;
}

function validateDatabaseUrl(
  environment: Environment,
  issues: string[],
  required: boolean,
): void {
  const value = text(environment.DATABASE_URL);

  if (!value) {
    if (required) {
      return;
    }
    return;
  }

  try {
    const url = new URL(value);

    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
      issues.push('DATABASE_URL deve utilizar PostgreSQL');
    }
  } catch {
    issues.push('DATABASE_URL possui formato inválido');
  }
}

function validateProviderUrl(
  environment: Environment,
  key: 'PAGBANK_API_URL' | 'EVOLUTION_BASE_URL',
  issues: string[],
  production: boolean,
): void {
  const value = text(environment[key]);

  if (!value) {
    return;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== 'https:' && production) {
      issues.push(`${key} deve utilizar HTTPS em produção`);
    }
  } catch {
    issues.push(`${key} possui formato inválido`);
  }
}

function validateCors(
  environment: Environment,
  issues: string[],
  production: boolean,
): void {
  const value = text(environment.CORS_ALLOWED_ORIGINS);

  if (!value) {
    return;
  }

  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0 || origins.includes('*')) {
    issues.push('CORS_ALLOWED_ORIGINS deve listar origens explícitas');
    return;
  }

  for (const origin of origins) {
    try {
      const url = new URL(origin);

      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.origin !== origin
      ) {
        issues.push(`Origem CORS inválida: ${origin}`);
      } else if (production && url.protocol !== 'https:') {
        issues.push(`Origem CORS deve utilizar HTTPS em produção: ${origin}`);
      }
    } catch {
      issues.push(`Origem CORS inválida: ${origin}`);
    }
  }
}

function validateSecrets(
  environment: Environment,
  issues: string[],
  production: boolean,
): void {
  for (const key of SECRET_KEYS) {
    const value = text(environment[key]);

    if (!value) {
      continue;
    }

    const minimum = key.startsWith('JWT_') ? 32 : 16;

    if (production && value.length < minimum) {
      issues.push(`${key} deve possuir ao menos ${minimum} caracteres`);
    }

    if (production && isPlaceholder(value)) {
      issues.push(`${key} não pode utilizar valor placeholder`);
    }
  }

  const access = text(environment.JWT_ACCESS_SECRET);
  const refresh = text(environment.JWT_REFRESH_SECRET);

  if (access && refresh && access === refresh) {
    issues.push('JWT_ACCESS_SECRET e JWT_REFRESH_SECRET devem ser diferentes');
  }
}

function validateDecimals(
  environment: Environment,
  issues: string[],
  production: boolean,
): void {
  for (const key of DECIMAL_KEYS) {
    const value = text(environment[key]);

    if (!value) {
      continue;
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed < 0) {
      issues.push(`${key} deve ser um número não negativo`);
    }

    if (production && key === 'ANALYTICS_USD_TO_BRL_RATE' && parsed <= 0) {
      issues.push('ANALYTICS_USD_TO_BRL_RATE deve ser maior que zero');
    }
  }
}

function validateIntegers(environment: Environment, issues: string[]): void {
  const values = new Map<string, number>();

  for (const rule of INTEGER_RULES) {
    const raw = text(environment[rule.key]);

    if (!raw && rule.fallback === undefined) {
      continue;
    }

    const value = Number(raw || rule.fallback);
    values.set(rule.key, value);

    if (!Number.isInteger(value) || value < rule.min || value > rule.max) {
      issues.push(
        `${rule.key} deve ser inteiro entre ${rule.min} e ${rule.max}`,
      );
    }
  }

  const retryBase = values.get('OUTBOX_RETRY_BASE_MS');
  const retryMax = values.get('OUTBOX_RETRY_MAX_MS');

  if (
    retryBase !== undefined &&
    retryMax !== undefined &&
    retryMax < retryBase
  ) {
    issues.push(
      'OUTBOX_RETRY_MAX_MS deve ser maior ou igual a OUTBOX_RETRY_BASE_MS',
    );
  }
}

function validateStorage(
  environment: Environment,
  issues: string[],
  production: boolean,
): void {
  const uploadPath = text(environment.UPLOAD_PATH);

  if (production && uploadPath && !isAbsolute(uploadPath)) {
    issues.push('UPLOAD_PATH deve ser absoluto em produção');
  }
}

function validateRuntime(
  environment: Environment,
  mode: RuntimeMode,
  issues: string[],
): void {
  const configuredMode = text(environment.RUNTIME_MODE);

  if (configuredMode && configuredMode !== mode) {
    issues.push(`RUNTIME_MODE deve ser ${mode}`);
  }

  if (mode === RUNTIME_MODE.WORKER) {
    const role = text(environment.WORKER_ROLE) || WORKER_ROLE.ALL;

    if (!Object.values(WORKER_ROLE).includes(role as WorkerRole)) {
      issues.push(`WORKER_ROLE inválido: ${role}`);
    }
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlaceholder(value: string): boolean {
  return /replace-with|change-me|changeme|example|your-|secret-here/i.test(
    value,
  );
}
