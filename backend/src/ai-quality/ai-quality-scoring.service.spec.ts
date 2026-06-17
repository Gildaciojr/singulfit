import { AIQualityScoringService } from './ai-quality-scoring.service';
import { AI_QUALITY_FLAG } from './interfaces/ai-quality.interface';

describe('AIQualityScoringService', () => {
  const service = new AIQualityScoringService();
  const context = {
    goal: 'MUSCLE_GAIN',
    memoryCount: 2,
    recentMealCount: 5,
    insightCount: 1,
    recommendationCount: 2,
    behaviorStage: 'ACTION',
    adherenceScore: 74,
  };

  it('scores contextual and practical WhatsApp responses highly', () => {
    const result = service.score(
      [
        'Observação da refeição:',
        'Para seu objetivo de ganho de massa, a proteína ficou abaixo do seu padrão recente.',
        'Insight contextual: seu histórico mostra oscilação.',
        'Recomendação prática: inclua ovos ou tofu na próxima refeição.',
        'Seu estágio é ação, com adesão prevista 74/100.',
      ].join('\n'),
      context,
    );

    expect(result.qualityScore).toBeGreaterThanOrEqual(80);
    expect(result.personalizationScore).toBeGreaterThanOrEqual(80);
    expect(result.usefulnessScore).toBeGreaterThanOrEqual(80);
    expect(result.flags).toEqual([]);
  });

  it('penalizes short generic responses without a practical action', () => {
    const result = service.score('Boa refeição.', context);

    expect(result.qualityScore).toBeLessThan(40);
    expect(result.flags).toEqual(
      expect.arrayContaining([
        AI_QUALITY_FLAG.GENERIC_RESPONSE,
        AI_QUALITY_FLAG.LOW_PERSONALIZATION,
        AI_QUALITY_FLAG.NO_PRACTICAL_ACTION,
      ]),
    );
  });

  it('flags content that is too long for WhatsApp', () => {
    const result = service.score(
      `Recomendação prática: inclua vegetais. ${'Detalhe adicional. '.repeat(200)}`,
      context,
    );

    expect(result.flags).toContain(AI_QUALITY_FLAG.WHATSAPP_TOO_LONG);
  });
});
