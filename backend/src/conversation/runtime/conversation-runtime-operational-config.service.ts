import { createHash } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CONVERSATION_RUNTIME_MODE,
  type ConversationRuntimeConfig,
  type ConversationRuntimeMode,
} from '../contracts/conversation-runtime.contract';

const DEFAULT_TIMEOUT_MS = 25_000;
const MODES = new Set<string>(Object.values(CONVERSATION_RUNTIME_MODE));

@Injectable()
export class ConversationRuntimeOperationalConfigService {
  constructor(@Optional() private readonly config?: ConfigService) {}

  get(): ConversationRuntimeConfig {
    const rawMode = this.read('CONVERSATION_RUNTIME_MODE') ?? 'OFF';
    const modeValid = MODES.has(rawMode);
    const rawKill = this.read('CONVERSATION_RUNTIME_KILL_SWITCH') ?? 'false';
    const killValid = rawKill === 'true' || rawKill === 'false';
    const percentage = this.integer(
      this.read('CONVERSATION_RUNTIME_CANARY_PERCENTAGE') ?? '0',
    );
    const timeout = this.integer(
      this.read('CONVERSATION_RUNTIME_TIMEOUT_MS') ??
        String(DEFAULT_TIMEOUT_MS),
    );
    const percentageValid =
      percentage !== null && percentage >= 0 && percentage <= 100;
    const timeoutValid =
      timeout !== null && timeout >= 1_000 && timeout <= 60_000;
    const valid = modeValid && killValid && percentageValid && timeoutValid;
    const killSwitch = rawKill === 'true';

    return Object.freeze({
      mode:
        valid && !killSwitch
          ? (rawMode as ConversationRuntimeMode)
          : CONVERSATION_RUNTIME_MODE.OFF,
      killSwitch,
      internalUserIds: Object.freeze(
        (this.read('CONVERSATION_RUNTIME_INTERNAL_USER_IDS') ?? '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
      canaryPercentage: percentageValid ? percentage : 0,
      timeoutMs: timeoutValid ? timeout : DEFAULT_TIMEOUT_MS,
      valid,
    });
  }

  isOfficiallyEligible(userId: string, config = this.get()): boolean {
    switch (config.mode) {
      case CONVERSATION_RUNTIME_MODE.INTERNAL:
        return config.internalUserIds.includes(userId);
      case CONVERSATION_RUNTIME_MODE.CANARY:
      case CONVERSATION_RUNTIME_MODE.ROLLOUT:
        return this.bucket(userId) < config.canaryPercentage;
      case CONVERSATION_RUNTIME_MODE.PRIMARY:
        return true;
      default:
        return false;
    }
  }

  private bucket(userId: string): number {
    const value = createHash('sha256').update(userId).digest().readUInt32BE(0);
    return (value % 10_000) / 100;
  }

  private read(key: string): string | undefined {
    const value = this.config?.get<string>(key) ?? process.env[key];
    return typeof value === 'string' ? value.trim() : undefined;
  }

  private integer(value: string): number | null {
    if (!/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
}
