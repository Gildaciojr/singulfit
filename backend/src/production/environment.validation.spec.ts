import {
  collectEnvironmentIssues,
  validateEnvironment,
} from './environment.validation';
import { RUNTIME_MODE } from './runtime-mode';

describe('production environment validation', () => {
  function validEnvironment(): Record<string, string> {
    return {
      NODE_ENV: 'production',
      RUNTIME_MODE: 'API',
      DATABASE_URL: 'postgresql://user:password@postgres:5432/singulfit',
      JWT_ACCESS_SECRET: 'a'.repeat(48),
      JWT_REFRESH_SECRET: 'b'.repeat(48),
      JWT_ISSUER: 'singulfit-api',
      JWT_AUDIENCE: 'singulfit-app',
      CORS_ALLOWED_ORIGINS: 'https://app.singulfit.example',
      PAGBANK_API_URL: 'https://api.pagseguro.com',
      PAGBANK_TOKEN: 'pagbank-token-production-value',
      PAGBANK_WEBHOOK_SECRET: 'pagbank-webhook-production-value',
      EVOLUTION_BASE_URL: 'https://evolution.singulfit.example',
      EVOLUTION_API_KEY: 'evolution-api-production-value',
      EVOLUTION_INSTANCE_NAME: 'singulfit',
      EVOLUTION_WEBHOOK_SECRET: 'evolution-webhook-production-value',
      OPENAI_API_KEY: 'openai-production-key-value',
      OPENAI_MODEL_TEXT: 'gpt-text',
      OPENAI_MODEL_VISION: 'gpt-vision',
      UPLOAD_PATH: '/var/lib/singulfit/uploads',
      OPENAI_TEXT_INPUT_COST_PER_1M_USD: '0.15',
      OPENAI_TEXT_OUTPUT_COST_PER_1M_USD: '0.60',
      OPENAI_VISION_INPUT_COST_PER_1M_USD: '2.50',
      OPENAI_VISION_OUTPUT_COST_PER_1M_USD: '10',
      ANALYTICS_USD_TO_BRL_RATE: '5.25',
      ANALYTICS_WHATSAPP_INBOUND_COST_BRL: '0',
      ANALYTICS_WHATSAPP_RESPONSE_COST_BRL: '0.05',
      ANALYTICS_WHATSAPP_AUTOMATION_COST_BRL: '0.08',
      ANALYTICS_STORAGE_GB_MONTH_COST_BRL: '0.12',
      WORKER_ROLE: 'ALL',
      PORT: '3000',
      TRUST_PROXY_HOPS: '1',
      BASIC_DAILY_IMAGE_LIMIT: '5',
      PREMIUM_DAILY_IMAGE_LIMIT: '999999',
      SUBSCRIPTION_GRACE_PERIOD_DAYS: '3',
      WEBHOOK_LEASE_SECONDS: '60',
      WEBHOOK_MAX_ATTEMPTS: '10',
      WORKER_POLL_MS: '1000',
      OUTBOX_WORKER_POLL_MS: '1000',
      AI_WORKER_POLL_MS: '1000',
      AUTOMATION_WORKER_POLL_MS: '1000',
      WORKER_STALE_SECONDS: '60',
      OUTBOX_BATCH_SIZE: '20',
      OUTBOX_LEASE_SECONDS: '120',
      OUTBOX_MAX_ATTEMPTS: '10',
      OUTBOX_RETRY_BASE_MS: '1000',
      OUTBOX_RETRY_MAX_MS: '300000',
      OUTBOX_BACKLOG_WARNING_MINUTES: '10',
      OUTBOX_RETENTION_DAYS: '30',
      WEBHOOK_RETENTION_DAYS: '90',
      SYSTEM_EVENT_RETENTION_DAYS: '90',
      AUDIT_RETENTION_DAYS: '365',
      RETENTION_CLEANUP_INTERVAL_MS: '3600000',
      RETENTION_CLEANUP_BATCH_SIZE: '1000',
      AI_JOB_LEASE_SECONDS: '120',
      AI_RESERVATION_TTL_SECONDS: '300',
      AI_RECOVERY_INTERVAL_MS: '30000',
      EVOLUTION_INBOUND_LEASE_SECONDS: '120',
      EVOLUTION_INBOUND_POLL_MS: '1000',
      EVOLUTION_RECOVERY_INTERVAL_MS: '30000',
      EVOLUTION_SEND_LEASE_SECONDS: '60',
      MAX_IMAGE_SIZE_MB: '10',
      MAX_AUDIO_SIZE_MB: '25',
      MAX_DOCUMENT_SIZE_MB: '25',
    };
  }

  it('accepts a complete production environment', () => {
    const environment = validEnvironment();

    expect(validateEnvironment(environment, RUNTIME_MODE.API)).toBe(
      environment,
    );
  });

  it('rejects missing, placeholder and unsafe production values', () => {
    const environment = validEnvironment();
    environment.JWT_ACCESS_SECRET = 'replace-with-secret';
    environment.JWT_REFRESH_SECRET = environment.JWT_ACCESS_SECRET;
    environment.CORS_ALLOWED_ORIGINS = '*';
    environment.PAGBANK_API_URL = 'http://pagbank.local';
    delete environment.OPENAI_MODEL_VISION;

    const issues = collectEnvironmentIssues(environment, RUNTIME_MODE.API);

    expect(issues).toEqual(
      expect.arrayContaining([
        'OPENAI_MODEL_VISION é obrigatória em produção',
        'CORS_ALLOWED_ORIGINS deve listar origens explícitas',
        'PAGBANK_API_URL deve utilizar HTTPS em produção',
        'JWT_ACCESS_SECRET não pode utilizar valor placeholder',
        'JWT_ACCESS_SECRET e JWT_REFRESH_SECRET devem ser diferentes',
      ]),
    );
  });

  it('validates worker role and numeric ranges', () => {
    const environment = validEnvironment();
    environment.RUNTIME_MODE = 'WORKER';
    environment.WORKER_ROLE = 'UNKNOWN';
    environment.OUTBOX_BATCH_SIZE = '0';

    const issues = collectEnvironmentIssues(environment, RUNTIME_MODE.WORKER);

    expect(issues).toEqual(
      expect.arrayContaining([
        'WORKER_ROLE inválido: UNKNOWN',
        'OUTBOX_BATCH_SIZE deve ser inteiro entre 1 e 100',
      ]),
    );
  });
});
