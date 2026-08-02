import { Injectable } from '@nestjs/common';
import type { ConversationRealizedResponse } from './conversation-response-payload.builder';

@Injectable()
export class ConversationResponseValidatorService {
  isValid(response: ConversationRealizedResponse): boolean {
    const message = response.message.trim();
    const question = response.followUpQuestion?.trim() ?? null;
    const rendered = question ? `${message} ${question}` : message;
    const questionMarks = rendered.match(/\?/g)?.length ?? 0;
    const prohibited =
      /\b(?:diagn[oó]stico|prescrev|salvei|gravei no sistema|[0-9a-f]{8}-[0-9a-f-]{27})\b/i;
    return (
      message.length > 0 &&
      rendered.length <= 4_000 &&
      response.requiresFollowUp === (question !== null) &&
      questionMarks <= 1 &&
      !/[{}]/.test(rendered) &&
      !prohibited.test(rendered)
    );
  }
}
