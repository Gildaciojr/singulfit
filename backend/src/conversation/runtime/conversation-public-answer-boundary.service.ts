import { Injectable } from '@nestjs/common';
import type { ConversationAnswerCandidate } from './conversation-qa.contract';

const INTERNAL_VALUE =
  /(?:\b(?:null|undefined|NaN)\b|\[object Object\]|\b(?:can[oô]nic[oa]|canonical|grounding|runtime|fallback|planner|pipeline|persist[eê]ncia|persistido|V2|DIET_V2|NUTRITION_V2|executor|provider|AIJob|prompt|schema|operationKey|correlationId|pilot\w*|aiJobId|providerId|promptVersionId|prismaId|artifact|artefato|metadata|ONBOARDING)\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b)/iu;
const MARKDOWN_TABLE = /(?:^\s*\|.*\|\s*$|^\s*:?-{3,}:?\s*(?:\|.*)?$)/u;
const BULLET = /^[-•]\s+/u;

@Injectable()
export class ConversationPublicAnswerBoundaryService {
  project(candidate: ConversationAnswerCandidate): string | null {
    const answer = this.projectText(candidate.answer);
    const followUp = this.projectText(candidate.followUpQuestion);
    if (candidate.disposition === 'CLARIFY') {
      return followUp ?? answer;
    }
    if (!answer) return null;
    return followUp ? `${answer}\n\n${followUp}` : answer;
  }

  projectText(value: string | null): string | null {
    if (!value) return null;
    const originalLines = value.replace(/\r\n/gu, '\n').split('\n');
    if (
      INTERNAL_VALUE.test(value) ||
      /```/u.test(value) ||
      originalLines.some((line) => MARKDOWN_TABLE.test(line.trim())) ||
      /\*\*(?!\*)/u.test(value.replace(/\*\*([^*\n]+)\*\*/gu, ''))
    ) {
      return null;
    }
    const lines = originalLines
      .join('\n')
      .replace(/\*\*([^*\n]+)\*\*/gu, '*$1*')
      .replace(/\[([^\]\n]+)\]\([^\s)]+\)/gu, '$1')
      .split('\n')
      .map((line) => line.replace(/^\s*#{1,6}\s*/u, '').trim())
      .filter((line) => !line || !MARKDOWN_TABLE.test(line));
    if (lines.filter((line) => BULLET.test(line)).length > 3) return null;
    const projected = lines
      .join('\n')
      .replace(/[ \t]{2,}/gu, ' ')
      .replace(/\n{3,}/gu, '\n\n')
      .trim();
    return projected && projected.length <= 4_000 ? projected : null;
  }
}
