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
    void input.config;
    void input.eligible;
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
