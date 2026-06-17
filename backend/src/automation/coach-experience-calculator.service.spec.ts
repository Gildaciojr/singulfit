import {
  BehavioralAdherenceStyle,
  BehavioralCommunicationStyle,
  BehavioralMotivationStyle,
  BehavioralPersonalityPattern,
  CoachAdaptationMode,
  CoachCommunicationProfileType,
  CoachMotivationalTrigger,
  CoachReengagementReason,
  GoalProgressionState,
  MotivationTriggerType,
  NutritionRelapseSeverity,
} from '@prisma/client';
import { CoachExperienceCalculatorService } from './coach-experience-calculator.service';

describe('CoachExperienceCalculatorService', () => {
  const calculator = new CoachExperienceCalculatorService();

  it('stabilizes communication changes against the previous profile', () => {
    const result = calculator.communication({
      communicationStyle: BehavioralCommunicationStyle.ANALYTICAL,
      adherenceStyle: BehavioralAdherenceStyle.FLEXIBLE,
      personalityPattern: BehavioralPersonalityPattern.DATA_ORIENTED,
      adaptationMode: CoachAdaptationMode.TECHNICAL,
      consistencyScore: 70,
      churnRisk: 'LOW',
      confidence: 0.86,
      previous: {
        dominantStyle: CoachCommunicationProfileType.DIRECT,
        scores: {
          DIRECT: 50,
          TECHNICAL: 15,
          MOTIVATIONAL: 10,
          DISCIPLINARIAN: 10,
          WARM: 5,
          BALANCED: 10,
        },
      },
    });

    expect(result.dominantStyle).toBe(CoachCommunicationProfileType.DIRECT);
    expect(result.scores.TECHNICAL).toBeGreaterThan(15);
    expect(result.confidence).toBe(0.86);
  });

  it('detects dominant motivational triggers with confidence', () => {
    const result = calculator.motivation({
      motivations: [
        { type: BehavioralMotivationStyle.PERFORMANCE, weight: 70 },
        { type: BehavioralMotivationStyle.HEALTH, weight: 30 },
      ],
      triggers: [{ type: MotivationTriggerType.PERFORMANCE, weight: 90 }],
      adherenceStyle: BehavioralAdherenceStyle.STRUCTURED,
      personalityPattern: BehavioralPersonalityPattern.CHALLENGE_ORIENTED,
      goal: 'HYPERTROPHY',
    });

    expect(result.dominantTrigger).toBe(CoachMotivationalTrigger.PERFORMANCE);
    expect(result.scores.PERFORMANCE).toBeGreaterThan(result.scores.DISCIPLINE);
    expect(result.confidence).toBeGreaterThan(0.45);
  });

  it('raises fatigue and spacing when messages repeat without interaction', () => {
    const result = calculator.fatigue({
      outboundContents: Array.from(
        { length: 12 },
        () => 'Inclua proteína na próxima refeição para manter consistência.',
      ),
      inboundCount: 0,
    });

    expect(result.fatigueScore).toBeGreaterThanOrEqual(70);
    expect(result.repeatedPhraseScore).toBeGreaterThanOrEqual(80);
    expect(result.recommendedFrequencyHours).toBeGreaterThanOrEqual(48);
  });

  it.each([
    {
      input: {
        daysInactive: 15,
        momentumScore: 50,
        fatigueScore: 20,
        evolutionState: GoalProgressionState.STABLE,
        relapseSeverity: null,
        seed: 1,
      },
      expected: CoachReengagementReason.TEMPORARY_ABANDONMENT,
    },
    {
      input: {
        daysInactive: 5,
        momentumScore: 55,
        fatigueScore: 20,
        evolutionState: GoalProgressionState.DECLINING,
        relapseSeverity: NutritionRelapseSeverity.HIGH,
        seed: 2,
      },
      expected: CoachReengagementReason.LACK_OF_RESULTS,
    },
    {
      input: {
        daysInactive: 5,
        momentumScore: 20,
        fatigueScore: 70,
        evolutionState: GoalProgressionState.STABLE,
        relapseSeverity: null,
        seed: 3,
      },
      expected: CoachReengagementReason.MOTIVATION_LOSS,
    },
  ])('classifies reengagement as $expected', ({ input, expected }) => {
    expect(calculator.reengagement(input).reason).toBe(expected);
  });

  it('calculates momentum, retention and WhatsApp heuristics', () => {
    const momentum = calculator.momentum({
      consistencyScore: 82,
      evolutionScore: 78,
      relapseSeverity: null,
      engagementScore: 74,
      adherenceScore: 80,
    });
    const retention = calculator.retention({
      usageScore: 75,
      engagementScore: 74,
      contextScore: 80,
      evolutionScore: 78,
      coachScore: 70,
      recommendationAcceptanceScore: 65,
    });
    const whatsapp = calculator.whatsapp({
      averageInboundLength: 45,
      averageOutboundLength: 500,
      preferredHourUtc: 9,
      communicationStyle: CoachCommunicationProfileType.WARM,
      fatigueScore: 72,
      frequencyHours: 48,
      interactionRate: 60,
    });

    expect(momentum.score).toBeGreaterThanOrEqual(75);
    expect(retention).toBeGreaterThanOrEqual(70);
    expect(whatsapp).toEqual(
      expect.objectContaining({
        idealMessageLength: 280,
        idealEmojiCount: 1,
        idealFrequencyHours: 48,
        preferredHourUtc: 9,
      }),
    );
  });
});
