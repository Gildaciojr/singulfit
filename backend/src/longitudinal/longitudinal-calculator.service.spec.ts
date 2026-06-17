import {
  CoachAdaptationMode,
  GoalProgressionState,
  LongitudinalDirection,
  NutritionRelapseSeverity,
  Prisma,
  UserGoalType,
} from '@prisma/client';
import { LongitudinalMealSignal } from './interfaces/longitudinal.interface';
import { LongitudinalCalculatorService } from './longitudinal-calculator.service';

describe('LongitudinalCalculatorService', () => {
  const service = new LongitudinalCalculatorService();

  function meal(
    score: number,
    proteinScore: number,
    sugarScore: number,
    ultraProcessedScore: number,
    at: string,
  ): LongitudinalMealSignal {
    return {
      calculatedAt: new Date(at),
      score,
      goalAdherenceScore: score,
      proteinScore,
      sugarScore,
      ultraProcessedScore,
      mealAnalysis: {
        hydrationMl: new Prisma.Decimal(score * 5),
        vegetableGrams: new Prisma.Decimal(score * 1.5),
        totalProtein: new Prisma.Decimal('30'),
        totalSugar: new Prisma.Decimal('8'),
        ultraProcessedRatio: new Prisma.Decimal('0.1'),
        items: [],
      },
    };
  }

  it('detects multidimensional improvement across consecutive windows', () => {
    const current = [
      meal(85, 90, 88, 90, '2026-06-12T12:00:00.000Z'),
      meal(80, 84, 82, 86, '2026-06-10T12:00:00.000Z'),
    ];
    const previous = [
      meal(55, 50, 48, 45, '2026-05-29T12:00:00.000Z'),
      meal(60, 54, 52, 50, '2026-05-27T12:00:00.000Z'),
    ];

    const result = service.evolution(current, previous);

    expect(result.overallDirection).toBe(LongitudinalDirection.IMPROVING);
    expect(result.directions.protein).toBe(LongitudinalDirection.IMPROVING);
    expect(result.current.quality).toBeGreaterThan(result.previous.quality);
  });

  it('classifies a broad regression as high-severity relapse', () => {
    const evolution = service.evolution(
      [meal(35, 30, 25, 20, '2026-06-12T12:00:00.000Z')],
      [meal(85, 90, 88, 90, '2026-05-29T12:00:00.000Z')],
    );

    const relapse = service.relapse(evolution, 20);

    expect(relapse).toEqual(
      expect.objectContaining({
        severity: NutritionRelapseSeverity.HIGH,
      }),
    );
    expect(relapse?.reasons).toEqual(
      expect.arrayContaining(['quality', 'protein', 'consistency']),
    );
  });

  it('evaluates goal progression without body weight', () => {
    const evolution = service.evolution(
      [meal(88, 94, 85, 90, '2026-06-12T12:00:00.000Z')],
      [meal(60, 58, 55, 52, '2026-05-29T12:00:00.000Z')],
    );

    const progression = service.goalProgression({
      goal: UserGoalType.HYPERTROPHY,
      evolution,
      consistencyScore: 86,
      adherenceScore: 84,
      behaviorScore: 78,
    });

    expect(progression.state).toBe(GoalProgressionState.IMPROVING);
    expect(progression.score).toBeGreaterThanOrEqual(80);
  });

  it.each([
    [
      {
        historySize: 20,
        consistencyScore: 88,
        adherenceScore: 84,
        relapseSeverity: null,
        analytical: false,
      },
      CoachAdaptationMode.PERFORMANCE,
    ],
    [
      {
        historySize: 5,
        consistencyScore: 30,
        adherenceScore: 40,
        relapseSeverity: NutritionRelapseSeverity.HIGH,
        analytical: false,
      },
      CoachAdaptationMode.RECOVERY,
    ],
    [
      {
        historySize: 15,
        consistencyScore: 65,
        adherenceScore: 68,
        relapseSeverity: null,
        analytical: true,
      },
      CoachAdaptationMode.TECHNICAL,
    ],
  ])('adapts coach behavior to longitudinal state', (input, expected) => {
    expect(service.coachAdaptation(input).mode).toBe(expected);
  });
});
