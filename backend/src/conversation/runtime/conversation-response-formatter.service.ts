import { Injectable } from '@nestjs/common';
import type { ConversationRealizedResponse } from './conversation-response-payload.builder';

@Injectable()
export class ConversationResponseFormatterService {
  format(response: ConversationRealizedResponse): string {
    const content = response.followUpQuestion
      ? `${response.message.trim()}\n\n${response.followUpQuestion.trim()}`
      : response.message.trim();
    return content.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  }
}
