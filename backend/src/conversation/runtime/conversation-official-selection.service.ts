import { Injectable } from '@nestjs/common';
import type {
  ConversationBridgeResult,
  ConversationOfficialSelection,
  ConversationRuntimeConfig,
  ConversationRuntimeEvaluation,
} from '../contracts/conversation-runtime.contract';

@Injectable()
export class ConversationOfficialSelectionService {
  select(input: {
    readonly legacyContent: string;
    readonly config: ConversationRuntimeConfig;
    readonly eligible: boolean;
    readonly evaluation: ConversationRuntimeEvaluation;
    readonly bridge: ConversationBridgeResult;
  }): ConversationOfficialSelection {
    if (
      !input.config.valid ||
      input.config.killSwitch ||
      input.config.mode === 'OFF'
    ) {
      return this.legacy(input.legacyContent, 'RUNTIME_DISABLED');
    }
    if (input.config.mode === 'SHADOW') {
      return this.legacy(input.legacyContent, 'SHADOW_ONLY');
    }
    if (!input.eligible) {
      return this.legacy(input.legacyContent, 'USER_NOT_ELIGIBLE');
    }
    if (
      input.evaluation.summary.status === 'OFFICIAL_CANDIDATE' &&
      input.evaluation.summary.ambiguityPresent === false &&
      input.bridge.status === 'COMPLETED' &&
      input.bridge.content.trim().length > 0
    ) {
      return Object.freeze({
        source: 'CONVERSATION_RUNTIME',
        content: input.bridge.content,
        reason: 'RUNTIME_SELECTED',
      });
    }
    return this.legacy(input.legacyContent, 'RUNTIME_FALLBACK');
  }

  legacy(
    content: string,
    reason: Exclude<
      ConversationOfficialSelection['reason'],
      'RUNTIME_SELECTED'
    >,
  ): ConversationOfficialSelection {
    return Object.freeze({ source: 'LEGACY', content, reason });
  }
}
