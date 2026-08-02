import { Injectable } from '@nestjs/common';
import type {
  NormalizedConversationMessage,
  TokenizedConversationMessage,
} from '../contracts/conversation-understanding-pipeline.contract';

@Injectable()
export class ConversationTokenizerService {
  tokenize(
    message: NormalizedConversationMessage,
  ): TokenizedConversationMessage {
    const tokens = message.folded.match(/[\p{L}\p{N}]+/gu) ?? [];
    return Object.freeze({
      tokens: Object.freeze(tokens),
      uniqueTokens: Object.freeze([...new Set(tokens)]),
    });
  }
}
