import { Injectable } from '@nestjs/common';
import type { ConversationAnswerCandidate } from './conversation-qa.contract';

const INTERNAL_VALUE =
  /(?:\b(?:null|undefined|NaN)\b|\[object Object\]|\b(?:operationKey|correlationId|executor|pilotStatus|NUTRITION_V2|DIET_V2|aiJobId|providerId|promptVersionId|prismaId|artifact|artefato|ONBOARDING)\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b)/iu;

@Injectable()
export class ConversationPublicAnswerBoundaryService {
  project(candidate: ConversationAnswerCandidate): string | null {
    const answer = this.safeLines(candidate.answer);
    const followUp = this.safeLines(candidate.followUpQuestion);
    if (candidate.disposition === 'CLARIFY') {
      return followUp ?? answer;
    }
    if (!answer) return null;
    return followUp ? `${answer}\n\n${followUp}` : answer;
  }

  private safeLines(value: string | null): string | null {
    if (!value) return null;
    const lines = value
      .replace(/\r\n/gu, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !INTERNAL_VALUE.test(line));
    const projected = lines.join('\n').trim();
    return projected && projected.length <= 4_000 ? projected : null;
  }
}
