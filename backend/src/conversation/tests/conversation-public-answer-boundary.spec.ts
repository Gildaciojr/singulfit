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
    'canônico',
    'canônica',
    'canonical',
    'grounding',
    'runtime',
    'fallback',
    'planner',
    'pipeline',
    'persistência',
    'persistido',
    'V2',
    'provider',
    'AIJob',
    'prompt',
    'schema',
    'pilot',
    '8fe3f460-1c2d-4a5b-9c6d-0123456789ab',
  ])('rejects the complete field containing internal value %s', (internal) => {
    const candidate: ConversationAnswerCandidate = {
      disposition: 'ANSWER',
      domain: 'GENERAL',
      answer: `Linha inválida com ${internal}.\nLinha pública preservada.`,
      followUpQuestion: null,
      grounding: 'GENERAL_KNOWLEDGE',
      confidence: 'HIGH',
    };

    expect(boundary.project(candidate)).toBeNull();
  });

  it('converts web bold to WhatsApp emphasis and removes heading markers', () => {
    expect(
      boundary.project({
        disposition: 'ANSWER',
        domain: 'NUTRITION',
        answer: '## Almoço\n**arroz branco**: 3 xícaras cozidas',
        followUpQuestion: null,
        grounding: 'CURRENT_PLAN',
        confidence: 'HIGH',
      }),
    ).toBe('Almoço\n*arroz branco*: 3 xícaras cozidas');
  });

  it.each([
    'Resumo público.\nOrientação canônica: arroz = 3 xícaras.',
    'Resumo público.\nID 8fe3f460-1c2d-4a5b-9c6d-0123456789ab.',
    'Resumo público.\n| alimento | quantidade |',
  ])('never publishes a partial answer after field contamination', (answer) => {
    expect(
      boundary.project({
        disposition: 'ANSWER',
        domain: 'NUTRITION',
        answer,
        followUpQuestion: null,
        grounding: 'CURRENT_PLAN',
        confidence: 'HIGH',
      }),
    ).toBeNull();
  });

  it('drops an invalid follow-up without contaminating a safe answer', () => {
    expect(
      boundary.project({
        disposition: 'ANSWER',
        domain: 'NUTRITION',
        answer: 'Seu almoço tem 3 xícaras de arroz.',
        followUpQuestion: 'Quer ver o grounding interno?',
        grounding: 'CURRENT_PLAN',
        confidence: 'HIGH',
      }),
    ).toBe('Seu almoço tem 3 xícaras de arroz.');
  });

  it.each([
    'orientação canônica',
    'canonical grounding',
    'runtime fallback',
    'planner pipeline',
    'estado persistido',
    'provider prompt schema',
  ])('never exposes public technical vocabulary: %s', (answer) => {
    expect(
      boundary.project({
        disposition: 'ANSWER',
        domain: 'GENERAL',
        answer,
        followUpQuestion: null,
        grounding: 'GENERAL_KNOWLEDGE',
        confidence: 'HIGH',
      }),
    ).toBeNull();
  });

  it('keeps at most three bullets without blindly truncating content', () => {
    expect(
      boundary.project({
        disposition: 'ANSWER',
        domain: 'NUTRITION',
        answer: '- Um\n- Dois\n- Três\n- Quatro',
        followUpQuestion: null,
        grounding: 'GENERAL_KNOWLEDGE',
        confidence: 'HIGH',
      }),
    ).toBeNull();
  });

  it('converts Markdown links and rejects tables and code fences', () => {
    const candidate: ConversationAnswerCandidate = {
      disposition: 'ANSWER',
      domain: 'GENERAL',
      answer: '[Guia simples](https://example.com)',
      followUpQuestion: null,
      grounding: 'GENERAL_KNOWLEDGE',
      confidence: 'HIGH',
    };

    expect(boundary.project(candidate)).toBe('Guia simples');
    expect(boundary.project({ ...candidate, answer: '| A | B |' })).toBeNull();
    expect(
      boundary.project({ ...candidate, answer: '```texto```' }),
    ).toBeNull();
  });
});
