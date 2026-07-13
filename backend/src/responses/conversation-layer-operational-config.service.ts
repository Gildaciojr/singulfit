import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const CONVERSATION_LAYER_MODE = {
  OFF: 'OFF',
  SHADOW: 'SHADOW',
  INTERNAL: 'INTERNAL',
  CANARY: 'CANARY',
  ROLLOUT: 'ROLLOUT',
  PRIMARY: 'PRIMARY',
} as const;

export type ConversationLayerMode =
  (typeof CONVERSATION_LAYER_MODE)[keyof typeof CONVERSATION_LAYER_MODE];

export interface ConversationLayerOperationalConfig {
  readonly configuredMode: ConversationLayerMode;
  readonly effectiveMode: ConversationLayerMode;
  readonly killSwitchEnabled: boolean;
}

const MODE_KEY = 'CONVERSATION_LAYER_MODE';
const KILL_SWITCH_KEY = 'CONVERSATION_LAYER_KILL_SWITCH';
const MODES = new Set<ConversationLayerMode>(
  Object.values(CONVERSATION_LAYER_MODE),
);
const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);
const DISABLED_VALUES = new Set(['0', 'false', 'no', 'off']);

@Injectable()
export class ConversationLayerOperationalConfigService {
  constructor(private readonly configService: ConfigService) {}

  get(): ConversationLayerOperationalConfig {
    const configuredMode = this.resolveMode(
      this.configService.get<string>(MODE_KEY),
    );
    const killSwitchEnabled = this.resolveKillSwitch(
      this.configService.get<string>(KILL_SWITCH_KEY),
    );

    return Object.freeze({
      configuredMode,
      effectiveMode: killSwitchEnabled
        ? CONVERSATION_LAYER_MODE.OFF
        : configuredMode,
      killSwitchEnabled,
    });
  }

  private resolveMode(value: string | undefined): ConversationLayerMode {
    const normalized = value?.trim().toUpperCase();

    return normalized && MODES.has(normalized as ConversationLayerMode)
      ? (normalized as ConversationLayerMode)
      : CONVERSATION_LAYER_MODE.OFF;
  }

  private resolveKillSwitch(value: string | undefined): boolean {
    const normalized = value?.trim().toLowerCase();

    if (!normalized || DISABLED_VALUES.has(normalized)) {
      return false;
    }

    if (ENABLED_VALUES.has(normalized)) {
      return true;
    }

    // An invalid configured value fails closed and keeps the new layer off.
    return true;
  }
}
