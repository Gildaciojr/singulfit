import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CONVERSATION_LAYER_MODE,
  ConversationLayerOperationalConfigService,
} from '../responses/conversation-layer-operational-config.service';

const CONVERSATION_GOAL_SHADOW_ENABLED_KEY = 'CONVERSATION_GOAL_SHADOW_ENABLED';
const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

export interface ConversationGoalShadowConfig {
  readonly requested: boolean;
  readonly enabled: boolean;
}

@Injectable()
export class ConversationGoalShadowConfigService {
  constructor(
    private readonly configService: ConfigService,
    private readonly operationalConfig: ConversationLayerOperationalConfigService,
  ) {}

  get(): ConversationGoalShadowConfig {
    const requested = this.requested(
      this.configService.get<string>(CONVERSATION_GOAL_SHADOW_ENABLED_KEY),
    );
    const operational = this.operationalConfig.get();

    return Object.freeze({
      requested,
      enabled:
        requested &&
        operational.effectiveMode === CONVERSATION_LAYER_MODE.SHADOW,
    });
  }

  private requested(value: string | undefined): boolean {
    return ENABLED_VALUES.has(value?.trim().toLowerCase() ?? '');
  }
}
