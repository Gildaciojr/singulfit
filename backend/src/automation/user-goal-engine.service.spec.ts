import { FitnessGoal, UserGoalType } from '@prisma/client';
import { UserGoalEngineService } from './user-goal-engine.service';

describe('UserGoalEngineService', () => {
  const service = new UserGoalEngineService();

  it('classifies muscle gain profiles as hypertrophy', () => {
    const result = service.classify({
      nutritionGoal: FitnessGoal.MUSCLE_GAIN,
      fitnessGoal: FitnessGoal.MUSCLE_GAIN,
      snapshotGoal: FitnessGoal.MUSCLE_GAIN,
      memorySummaries: ['Quero ganhar massa muscular com consistência'],
    });

    expect(result.goal).toBe(UserGoalType.HYPERTROPHY);
    expect(result.confidence.toNumber()).toBeGreaterThan(0.8);
  });

  it('uses persistent memory to distinguish health from maintenance', () => {
    const result = service.classify({
      nutritionGoal: FitnessGoal.MAINTENANCE,
      fitnessGoal: FitnessGoal.MAINTENANCE,
      snapshotGoal: FitnessGoal.MAINTENANCE,
      memorySummaries: [
        'Meu foco é saúde, energia, bem-estar e qualidade de vida',
      ],
    });

    expect(result.goal).toBe(UserGoalType.HEALTH);
    expect(result.evidence).toEqual(
      expect.objectContaining({
        memoryOverride: UserGoalType.HEALTH,
      }),
    );
  });
});
