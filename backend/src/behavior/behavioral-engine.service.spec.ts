import {
  BehavioralCommunicationStyle,
  BehavioralInsightType,
  BehavioralMotivationStyle,
  MotivationTriggerType,
  StageOfChange,
} from '@prisma/client';
import { BehavioralEngineService } from './behavioral-engine.service';
import { BehavioralEngineInput } from './interfaces/behavioral.interface';

describe('BehavioralEngineService', () => {
  const service = new BehavioralEngineService();

  function input(
    overrides: Partial<BehavioralEngineInput> = {},
  ): BehavioralEngineInput {
    return {
      messages: [
        {
          content: 'Quero acompanhar meu score e meus dados',
          timestamp: new Date('2026-06-08T08:10:00.000Z'),
        },
        {
          content: 'Minha meta é performance no treino',
          timestamp: new Date('2026-06-09T08:20:00.000Z'),
        },
        {
          content: 'Mostre a média de proteína',
          timestamp: new Date('2026-06-10T08:30:00.000Z'),
        },
        {
          content: 'Quero melhorar meu desempenho',
          timestamp: new Date('2026-06-11T08:40:00.000Z'),
        },
      ],
      memorySummaries: ['Busca hipertrofia e acompanha medidas'],
      goal: 'HYPERTROPHY',
      activeDays: 18,
      consecutiveDays: 9,
      mealFrequency: 6,
      regularityScore: 82,
      consistencyScore: 84,
      engagementScore: 76,
      contextAdherenceScore: 80,
      trendAdherenceScore: 78,
      analysesLast30Days: 12,
      responsesSent: 5,
      responsesFollowedByInteraction: 4,
      progressRecords: 3,
      improvingTrend: true,
      previousStage: StageOfChange.ACTION,
      ...overrides,
    };
  }

  it('classifies communication, motivation, stage and adherence from evidence', () => {
    const result = service.evaluate(input());

    expect(result.communicationStyle).toBe(
      BehavioralCommunicationStyle.ANALYTICAL,
    );
    expect(result.dominantMotivation).toBe(
      BehavioralMotivationStyle.PERFORMANCE,
    );
    expect(result.motivations.reduce((sum, item) => sum + item.weight, 0)).toBe(
      100,
    );
    expect(result.stage).toBe(StageOfChange.MAINTENANCE);
    expect(result.adherence.score).toBeGreaterThanOrEqual(75);
    expect(result.adherence.score).toBeLessThanOrEqual(100);
    expect(result.preferredEngagementHour).toBe(8);
  });

  it('detects behavioral triggers and evidence-backed insights', () => {
    const result = service.evaluate(input());

    expect(result.triggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: MotivationTriggerType.PROGRESS,
        }),
        expect.objectContaining({
          type: MotivationTriggerType.PERFORMANCE,
        }),
      ]),
    );
    expect(result.insights).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: BehavioralInsightType.DATA_RESPONSIVE,
        }),
        expect.objectContaining({
          type: BehavioralInsightType.MORNING_ENGAGEMENT,
        }),
      ]),
    );
  });

  it('stabilizes stage changes when evidence confidence is limited', () => {
    const result = service.evaluate(
      input({
        messages: [{ content: 'Estou pensando nisso', timestamp: new Date() }],
        memorySummaries: [],
        goal: null,
        activeDays: 0,
        consecutiveDays: 0,
        mealFrequency: 0,
        regularityScore: 0,
        consistencyScore: 0,
        engagementScore: 0,
        contextAdherenceScore: null,
        trendAdherenceScore: null,
        analysesLast30Days: 0,
        responsesSent: 0,
        responsesFollowedByInteraction: 0,
        progressRecords: 0,
        improvingTrend: false,
        previousStage: StageOfChange.MAINTENANCE,
      }),
    );

    expect(result.stage).toBe(StageOfChange.ACTION);
    expect(result.stageConfidence).toBeLessThan(0.8);
  });
});
