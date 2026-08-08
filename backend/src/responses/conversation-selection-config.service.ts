import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CONVERSATION_SELECTION_ROLLOUT_MODE,
  ConversationSelectionRolloutMode,
} from './conversation-candidate-selection.contract';

export interface ConversationSelectionConfig {
  readonly configuredMode: ConversationSelectionRolloutMode;
  readonly effectiveMode: ConversationSelectionRolloutMode;
  readonly formatterVersion: string;
}

const MODE_KEY = 'CONVERSATION_CANDIDATE_SELECTION_MODE';
const FORMATTER_VERSION_KEY = 'NUTRITION_RESPONSE_FORMATTER_VERSION';
const DEFAULT_FORMATTER_VERSION = 'nutrition-response-formatter:v1';
const MODES = new Set<ConversationSelectionRolloutMode>(
  Object.values(CONVERSATION_SELECTION_ROLLOUT_MODE),
);

@Injectable()
export class ConversationSelectionConfigService {
  constructor(private readonly configService: ConfigService) {}

  get(): ConversationSelectionConfig {
    const configuredMode = this.resolveMode(
      this.configService.get<string>(MODE_KEY),
    );

    return Object.freeze({
      configuredMode,
      effectiveMode: configuredMode,
      formatterVersion: this.resolveFormatterVersion(
        this.configService.get<string>(FORMATTER_VERSION_KEY),
      ),
    });
  }

  private resolveMode(
    value: string | undefined,
  ): ConversationSelectionRolloutMode {
    const normalized = value?.trim().toUpperCase();

    return normalized &&
      MODES.has(normalized as ConversationSelectionRolloutMode)
      ? (normalized as ConversationSelectionRolloutMode)
      : CONVERSATION_SELECTION_ROLLOUT_MODE.OFF;
  }

  private resolveFormatterVersion(value: string | undefined): string {
    const normalized = value?.trim();

    return normalized && normalized.length <= 100
      ? normalized
      : DEFAULT_FORMATTER_VERSION;
  }
}
