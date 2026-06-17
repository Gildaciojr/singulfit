import {
  ActivationRiskLevel,
  ActivationStage,
  UserActivation,
} from '@prisma/client';
import { ActivationScoreService } from './activation-score.service';

describe('ActivationScoreService', () => {
  const service = new ActivationScoreService();
  const at = new Date('2026-06-14T12:00:00.000Z');

  it('weights meals, analysis, recommendations and coach interaction most', () => {
    expect(
      service.calculate({
        registeredAt: at,
        paidAt: at,
        whatsappConnectedAt: at,
        firstMessageSentAt: at,
        firstMealReceivedAt: at,
        firstAnalysisCompletedAt: at,
        firstRecommendationDeliveredAt: at,
        firstCoachInteractionAt: at,
      }),
    ).toBe(100);

    expect(
      service.calculate({
        registeredAt: at,
        paidAt: at,
        whatsappConnectedAt: at,
        firstMessageSentAt: at,
        firstMealReceivedAt: null,
        firstAnalysisCompletedAt: null,
        firstRecommendationDeliveredAt: null,
        firstCoachInteractionAt: null,
      }),
    ).toBe(25);
  });

  it('classifies stalled journeys without overriding terminal semantics', () => {
    const base = {
      currentStage: ActivationStage.FIRST_MESSAGE_SENT,
      lastProgressAt: new Date('2026-06-11T12:00:00.000Z'),
      firstMealReceivedAt: null,
    };

    expect(service.risk(base, at)).toBe(ActivationRiskLevel.HIGH);
    expect(
      service.risk(
        {
          ...base,
          currentStage: ActivationStage.ACTIVATED,
        },
        at,
      ),
    ).toBe(ActivationRiskLevel.LOW);
    expect(
      service.risk(
        {
          ...base,
          currentStage: ActivationStage.ABANDONED,
        },
        at,
      ),
    ).toBe(ActivationRiskLevel.HIGH);
  });

  it('uses medium risk after 24 hours without progress', () => {
    expect(
      service.risk(
        {
          currentStage: ActivationStage.PAID,
          lastProgressAt: new Date('2026-06-13T11:00:00.000Z'),
          firstMealReceivedAt: new Date('2026-06-13T10:00:00.000Z'),
        } as Pick<
          UserActivation,
          'currentStage' | 'lastProgressAt' | 'firstMealReceivedAt'
        >,
        at,
      ),
    ).toBe(ActivationRiskLevel.MEDIUM);
  });
});
