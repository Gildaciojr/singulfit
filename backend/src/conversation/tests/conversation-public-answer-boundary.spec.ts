import { ConversationPublicAnswerBoundaryService } from '../runtime/conversation-public-answer-boundary.service';
import type { ConversationAnswerCandidate } from '../runtime/conversation-qa.contract';

describe('ConversationPublicAnswerBoundaryService', () => {
  const boundary = new ConversationPublicAnswerBoundaryService();

  it.each([
    'null',
    'undefined',
    'NaN',
    '[object Object]',
    'operationKey',
    'correlationId',
    'executor',
    'pilotStatus',
    'NUTRITION_V2',
    'DIET_V2',
    'aiJobId',
    'providerId',
    'artifact',
    'artefato',
    'ONBOARDING',
    '8fe3f460-1c2d-4a5b-9c6d-0123456789ab',
  ])('omits a complete line containing internal value %s', (internal) => {
    const candidate: ConversationAnswerCandidate = {
      disposition: 'ANSWER',
      domain: 'GENERAL',
      answer: `Linha inválida com ${internal}.\nLinha pública preservada.`,
      followUpQuestion: null,
      grounding: 'GENERAL_KNOWLEDGE',
      confidence: 'HIGH',
    };

    expect(boundary.project(candidate)).toBe('Linha pública preservada.');
  });
});
