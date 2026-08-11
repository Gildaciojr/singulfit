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

  it.each([
    [FitnessGoal.WEIGHT_LOSS, UserGoalType.WEIGHT_LOSS],
    [FitnessGoal.MUSCLE_GAIN, UserGoalType.HYPERTROPHY],
    [FitnessGoal.MAINTENANCE, UserGoalType.MAINTENANCE],
  ])(
    'preserves the canonical %s goal without current intent',
    (goal, expected) => {
      expect(
        service.classify({
          nutritionGoal: goal,
          fitnessGoal: goal,
          snapshotGoal: goal,
          memorySummaries: [],
        }).goal,
      ).toBe(expected);
    },
  );

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

  it.each([
    ['Agora quero emagrecer.', FitnessGoal.WEIGHT_LOSS],
    ['Quero ganhar massa muscular.', FitnessGoal.MUSCLE_GAIN],
    ['Meu objetivo mudou, quero manutenção.', FitnessGoal.MAINTENANCE],
  ])('resolves an explicit current goal in %s', (message, expected) => {
    expect(service.resolveCurrentMessage(message)).toMatchObject({
      status: 'RESOLVED',
      primaryGoal: expected,
    });
  });

  it('preserves a composite goal instead of silently mapping it to maintenance', () => {
    expect(
      service.resolveCurrentMessage(
        'Quero perder gordura e ganhar massa muscular.',
      ),
    ).toMatchObject({
      status: 'REQUIRES_CONFIRMATION',
      reason: 'COMPOSITE_GOAL_UNSUPPORTED',
      composite: true,
      declaredOutcome: 'perder gordura e ganhar massa muscular',
    });
  });

  it.each([
    ['Não quero emagrecer demais.', 'REQUIRES_CONFIRMATION'],
    ['Minha esposa quer emagrecer.', 'NO_CHANGE'],
    ['Eu estava tentando ganhar massa no ano passado.', 'NO_CHANGE'],
    ['Não sei se quero emagrecer ou ganhar massa.', 'REQUIRES_CONFIRMATION'],
  ])(
    'does not replace the goal for unsafe wording in %s',
    (message, status) => {
      expect(service.resolveCurrentMessage(message).status).toBe(status);
    },
  );
});
