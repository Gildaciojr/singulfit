import { applyNutritionTargetedMutation } from '../../diet/v2/nutrition-targeted-mutation.policy';
import type {
  GeneratedNutritionPlanCandidate,
  NutritionPlanV2,
} from '../../diet/v2/nutrition-plan-v2.contract';
import { applyWorkoutTargetedMutation } from '../../workout/v2/workout-targeted-mutation.policy';
import type {
  GeneratedWorkoutPlanV2Candidate,
  WorkoutPlanV2,
} from '../../workout/v2/workout-plan-v2.contract';
import { NutritionPlanV2Validator } from '../../diet/v2/nutrition-plan-v2.validator';
import type { NutritionPlanningContext } from '../../diet/v2/nutrition-planning-context.contract';
import type { NutritionPlanningStrategy } from '../../diet/v2/nutrition-planning-strategy.contract';

describe('Targeted V2 mutation preservation', () => {
  const food = (
    itemKey: string,
    foodName: string,
    allergenTags: string[] = [],
  ) => ({
    itemKey,
    foodName,
    role: 'PROTEIN',
    quantity: '120 g',
    caloriesKcal: null,
    macros: { proteinGrams: null, carbohydrateGrams: null, fatGrams: null },
    allergenTags,
    dietaryTags: [],
  });
  const meal = (mealKey: string, items: ReturnType<typeof food>[]) => ({
    mealKey,
    name: mealKey,
    period: 'LUNCH',
    suggestedTime: '12:00',
    items,
    alternatives: [],
  });
  function nutrition() {
    return {
      title: 'Original',
      objectiveSummary: 'Original goal',
      guidance: ['original guidance'],
      substitutions: [],
      adaptationRules: [],
      hydrationGuidance: [],
      safetyNotes: [],
      days: [
        {
          dayNumber: 1,
          label: 'Segunda-feira',
          trainingDay: false,
          meals: [
            meal('lunch', [food('rice', 'Arroz'), food('chicken', 'Frango')]),
            meal('dinner', [food('dinner-item', 'Peixe')]),
          ],
        },
        {
          dayNumber: 2,
          label: 'Terça-feira',
          trainingDay: false,
          meals: [meal('tuesday', [food('other', 'Arroz')])],
        },
      ],
    } as unknown as NutritionPlanV2;
  }
  const target = {
    dayNumber: 1,
    mealKey: 'lunch',
    itemKey: 'chicken',
    request: 'troque o frango',
    sourcePlanId: 'source',
  };
  it('replaces only chicken and discards attempted changes to rice, dinner, other days and goal', () => {
    const source = nutrition();
    const candidate = {
      ...source,
      title: 'Changed',
      objectiveSummary: 'Changed goal',
      days: [
        {
          ...source.days[0],
          meals: [
            meal('lunch', [
              food('rice', 'Wrong rice'),
              food('chicken', 'Ovos'),
            ]),
          ],
        },
      ],
    } as unknown as GeneratedNutritionPlanCandidate;
    const result = applyNutritionTargetedMutation(candidate, source, target);
    expect(result.days[0].meals[0].items.map((item) => item.foodName)).toEqual([
      'Arroz',
      'Ovos',
    ]);
    expect(result.days[0].meals[1]).toBe(source.days[0].meals[1]);
    expect(result.days[1]).toBe(source.days[1]);
    expect(result.objectiveSummary).toBe(source.objectiveSummary);
    expect(result.title).toBe(source.title);
    expect(source.days[0].meals[0].items[1].foodName).toBe('Frango');
  });
  it('replaces only the meal content while preserving its day, time and every other meal', () => {
    const source = nutrition();
    const candidate = {
      ...source,
      days: [
        { ...source.days[0], meals: [meal('lunch', [food('new', 'Batata')])] },
      ],
    } as unknown as GeneratedNutritionPlanCandidate;
    const result = applyNutritionTargetedMutation(candidate, source, {
      ...target,
      itemKey: null,
    });
    expect(result.artifactType).toBe('PLAN_ADAPTATION');
    expect(result.days[0].meals[0]).toMatchObject({
      mealKey: 'lunch',
      suggestedTime: '12:00',
      items: [{ foodName: 'Batata' }],
    });
    expect(result.days[1]).toBe(source.days[1]);
  });
  it('rejects missing/duplicate or unchanged mutation targets', () => {
    const source = nutrition();
    expect(() =>
      applyNutritionTargetedMutation(
        source as unknown as GeneratedNutritionPlanCandidate,
        source,
        target,
      ),
    ).toThrow('did not change');
    expect(() =>
      applyNutritionTargetedMutation(
        { ...source, days: [] } as unknown as GeneratedNutritionPlanCandidate,
        source,
        target,
      ),
    ).toThrow('target mismatch');
  });
  it.each([
    ['LACTOSE', 'Queijo'],
    ['PEANUT', 'Amendoim'],
  ])(
    'validates the patched whole document against %s before persistence',
    (code, foodName) => {
      const source = nutrition();
      const candidate = {
        ...source,
        days: [
          {
            ...source.days[0],
            meals: [meal('lunch', [food('chicken', foodName, [code])])],
          },
        ],
      } as unknown as GeneratedNutritionPlanCandidate;
      const patched = applyNutritionTargetedMutation(candidate, source, target);
      const context = {
        constraints: [
          { code, kind: 'ALLERGY', status: 'CONFIRMED', label: code },
        ],
        preferences: [],
      } as unknown as NutritionPlanningContext;
      const strategy = {
        artifactType: 'FOOD_SUBSTITUTION',
        dayCount: 2,
        mealCountPerDay: { status: 'NOT_SET' },
        appliedConstraintCodes: [code],
        excludedFoods: [],
        energyTargetKcal: { status: 'NOT_SET' },
        macroTargets: { status: 'NOT_SET' },
      } as unknown as NutritionPlanningStrategy;
      const validation = new NutritionPlanV2Validator().validate(
        patched,
        context,
        strategy,
      );
      expect(validation.status).toBe('INVALID');
      expect(validation.issues).toContainEqual(
        expect.objectContaining({ code: 'FORBIDDEN_CONSTRAINT' }),
      );
    },
  );
  const activity = (
    activityKey: string,
    name: string,
    movementPattern = 'PUSH',
  ) => ({
    activityKey,
    name,
    kind: 'STRENGTH',
    movementPattern,
    sets: 3,
    repetitions: '10',
    restSeconds: 60,
    intensity: 'MODERATE',
  });
  it('replaces one workout activity preserving all other sessions, blocks, progression and goal', () => {
    const source = {
      title: 'Original workout',
      modality: 'GYM_STRENGTH',
      objective: 'HYPERTROPHY',
      progression: [],
      substitutions: [],
      adaptationRules: [],
      safetyFlags: [],
      sessions: [
        {
          sessionKey: 'one',
          blocks: [
            {
              blockKey: 'main',
              activities: [
                activity('press', 'Supino'),
                activity('row', 'Remada', 'PULL'),
              ],
            },
          ],
        },
        {
          sessionKey: 'two',
          blocks: [
            {
              blockKey: 'two-main',
              activities: [activity('squat', 'Agachamento', 'SQUAT')],
            },
          ],
        },
      ],
    } as unknown as WorkoutPlanV2;
    const candidate = {
      ...source,
      title: 'Wrong title',
      sessions: [
        {
          sessionKey: 'one',
          blocks: [
            { blockKey: 'main', activities: [activity('press', 'Flexão')] },
          ],
        },
      ],
    } as unknown as GeneratedWorkoutPlanV2Candidate;
    const patched = applyWorkoutTargetedMutation(candidate, source, 'press');
    expect(patched.sessions[0].blocks[0].activities[0].name).toBe('Flexão');
    expect(patched.sessions[0].blocks[0].activities[1]).toBe(
      source.sessions[0].blocks[0].activities[1],
    );
    expect(patched.sessions[1]).toEqual(source.sessions[1]);
    expect(patched.title).toBe(source.title);
    expect(patched.sessions[0].blocks[0].activities[0]).toMatchObject({
      sets: 3,
      repetitions: '10',
      restSeconds: 60,
    });
    expect(() =>
      applyWorkoutTargetedMutation(
        {
          ...candidate,
          sessions: [
            {
              ...candidate.sessions[0],
              blocks: [
                {
                  ...candidate.sessions[0].blocks[0],
                  activities: [activity('press', 'Agachamento', 'SQUAT')],
                },
              ],
            },
          ],
        },
        source,
        'press',
      ),
    ).toThrow('target function');
  });
});
