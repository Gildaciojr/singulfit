import { Injectable } from '@nestjs/common';
import type {
  ConversationUnderstandingInput,
  ConversationUnderstandingResult,
} from '../contracts/conversation-understanding.contract';
import { ConversationUnderstandingEngineService } from './conversation-understanding-engine.service';

@Injectable()
export class ConversationUnderstandingService {
  constructor(
    private readonly engine: ConversationUnderstandingEngineService,
  ) {}

  understand(
    input: ConversationUnderstandingInput,
  ): Promise<ConversationUnderstandingResult> {
    return Promise.resolve(this.engine.understand(input));
  }
}
