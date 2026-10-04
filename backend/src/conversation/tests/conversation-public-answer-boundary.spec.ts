import { ConversationPublicAnswerBoundaryService } from '../runtime/conversation-public-answer-boundary.service';
import type { ConversationAnswerCandidate } from '../runtime/conversation-qa.contract';

describe('ConversationPublicAnswerBoundaryService', () => {
  const boundary = new ConversationPublicAnswerBoundaryService();

  it('retains the Q&A bullet limit while accepting structured prescriptions', () => {
    const text =
      '*Supino reto*\n• 4 séries × 8–10 repetições\n• Descanso: 1 min 30 s\n• Equipamento: barra + banco\n• Intensidade: moderada\n\n💡 Controle a descida.';
    expect(boundary.projectText(text)).toBeNull();
    expect(boundary.projectStructuredText(text)).toBe(text);
    expect(boundary.projectText('• Um\n• Dois\n• Três')).toBe(
      '• Um\n• Dois\n• Três',
    );
  });

  it.each([
    '```\nSEGREDO_LIVRE\n```',
    'AIJob\nSEGREDO_ADJACENTE',
    '| Coluna | Valor |\n| --- | --- |\n| SEGREDO_TABELA | arbitrário |',
    '12f2331b-efa4-4207-867a-9593a1350a2e\nSEGREDO_UUID',
    'promptVersionId\nSEGREDO_PROMPT',
    '**ênfase não fechada\nSEGREDO_MARKDOWN',
  ])('rejects the entire contaminated structured text: %s', (value) => {
    expect(boundary.projectStructuredText(value)).toBeNull();
    expect(boundary.projectText(value)).toBeNull();
  });

  it('shares normalization and keeps bounded structured output', () => {
    const text =
      '## Treino\r\n**Supino**\r\n\r\n\r\n[Orientação](https://example.com)  segura';
    expect(boundary.projectStructuredText(text)).toBe(
      boundary.projectText(text),
    );
    expect(boundary.projectStructuredText(null)).toBeNull();
    expect(boundary.projectStructuredText(' ')).toBeNull();
    expect(boundary.projectText('a'.repeat(4001))).toBeNull();
    expect(boundary.projectStructuredText('a'.repeat(4001))).toHaveLength(4001);
    expect(boundary.projectStructuredText('a'.repeat(32000))).toHaveLength(
      32000,
    );
    expect(boundary.projectStructuredText('a'.repeat(32001))).toBeNull();
  });

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
    'rollout',
    'internal',
    'persistence',
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
