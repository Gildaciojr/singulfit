import { BadGatewayException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ActivityLevel,
  AIJobStatus,
  AIJobType,
  DietPlanStatus,
  FitnessGoal,
  FoodPreferenceKind,
  Gender,
} from '@prisma/client';
import { AIService } from '../../ai/ai.service';
import { AIUsageService } from '../../ai/ai-usage.service';
import {
  COACH_PROFILE_DATA_SOURCE,
  type CoachProfileDatum,
  type CoachProfileSnapshot,
} from '../../context/coach-profile-snapshot.contract';
import {
  CONVERSATION_GOAL,
  CONVERSATION_RECOGNIZED_INTENT,
  type ConversationGoalDecision,
} from '../../context/conversation-goal-planner.contract';
import { NutritionArtifactResolverService } from './nutrition-artifact-resolver.service';
import { NutritionPlanV2Formatter } from './nutrition-plan-v2.formatter';
import { NutritionPlanV2Parser } from './nutrition-plan-v2.parser';
import { NutritionPlanV2Validator } from './nutrition-plan-v2.validator';
import type {
  GeneratedNutritionPlanCandidate,
  NutritionPlanV2,
} from './nutrition-plan-v2.contract';
import type { NutritionConversationalCandidate } from './nutrition-conversational-artifact.contract';
import { NutritionConversationalArtifactValidator } from './nutrition-conversational-artifact.validator';
import { NutritionGenerationRunnerV2Service } from './nutrition-generation-runner-v2.service';
import {
  NUTRITION_ARTIFACT_TYPE,
  type NutritionArtifactType,
} from './nutrition-planning-artifact.contract';
import { NutritionPlanningContextBuilder } from './nutrition-planning-context.builder';
import { NutritionPlanningEngineV2Service } from './nutrition-planning-engine-v2.service';
import { NutritionPlanningReadinessService } from './nutrition-planning-readiness.service';
import { NutritionPlanningSafetyService } from './nutrition-planning-safety.service';
import { NutritionPlanningStrategyService } from './nutrition-planning-strategy.service';

describe('Nutrition Planning Engine V2', () => {
  const referenceDate = new Date('2026-07-16T12:00:00.000Z');

  function known<T>(value: T): CoachProfileDatum<T> {
    return Object.freeze({
      status: 'KNOWN',
      value,
      sources: Object.freeze([COACH_PROFILE_DATA_SOURCE.USER]),
    });
  }

  function unknown<T>(): CoachProfileDatum<T> {
    return Object.freeze({ status: 'UNKNOWN', sources: Object.freeze([]) });
  }

  function snapshot(
    options: {
      readonly medical?: boolean;
      readonly missingAge?: boolean;
      readonly workout?: boolean;
      readonly rejectedFood?: string;
      readonly customRestriction?: string;
      readonly withoutFoodRestrictions?: boolean;
    } = {},
  ): CoachProfileSnapshot {
    return Object.freeze({
      identity: Object.freeze({
        userId: known('technical-user-id'),
        displayName: known('Ana'),
        onboardingCompleted: known(true),
      }),
      physical: Object.freeze({
        sex: known(Gender.FEMALE),
        birthDate: known('1991-01-01'),
        ageYears: options.missingAge ? unknown<number>() : known(35),
        heightCm: known(165),
        currentWeightKg: known(70),
        targetWeightKg: known(64),
        activityLevel: known(ActivityLevel.MODERATE),
      }),
      nutrition: Object.freeze({
        primaryGoal: known(FitnessGoal.WEIGHT_LOSS),
        desiredOutcome: known('Perder peso com rotina sustentável'),
        desiredMealCount: known(3),
        dietaryPattern: known('OMNIVORE'),
        foodIntolerances: known(Object.freeze([])),
        declaredFoodPreferences: known(Object.freeze(['Arroz'])),
        declaredFoodRejections: known(Object.freeze([])),
        cookingAvailability: known('MODERATE'),
        mealsAwayFromHome: known(false),
        eatingOutFrequency: known('SOMETIMES'),
        foodBudget: known('MODERATE'),
        supplementation: unknown<readonly string[]>(),
        hydration: known('ADEQUATE'),
      }),
      training: Object.freeze({
        primaryGoal: known(FitnessGoal.WEIGHT_LOSS),
        experienceLevel: unknown<string>(),
        preferredModality: unknown<string>(),
        weeklyFrequency: unknown<number>(),
        sessionDurationMinutes: unknown<number>(),
        environment: unknown<string>(),
        availableEquipment: unknown<readonly string[]>(),
        perceivedConditioning: unknown<string>(),
        intensityPreference: unknown<string>(),
        cardioAvailability: unknown<boolean>(),
        trainingFormatPreference: unknown<string>(),
      }),
      routine: Object.freeze({
        wakeUpTime: known('07:00'),
        sleepTime: known('23:00'),
        trainingTime: known('18:30'),
        mealTimes: known(Object.freeze(['08:00', '13:00', '20:00'])),
        availableTrainingDays: unknown<readonly string[]>(),
        dailyTrainingWindows: unknown<readonly string[]>(),
      }),
      restrictions: Object.freeze({
        foodRestrictions: known(
          options.withoutFoodRestrictions
            ? Object.freeze([])
            : Object.freeze([
                Object.freeze({
                  type: 'INTOLERANCE',
                  description: options.customRestriction ?? 'Sem lactose',
                  source: COACH_PROFILE_DATA_SOURCE.FITNESS_PROFILE,
                }),
              ]),
        ),
        allergies: known(Object.freeze([])),
        medicalConditions: known(
          options.medical
            ? Object.freeze([
                Object.freeze({
                  description: 'Acompanhamento clínico',
                  source: COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE,
                }),
              ])
            : Object.freeze([]),
        ),
        physicalLimitations: unknown<readonly never[]>(),
      }),
      preferences: Object.freeze({
        foodPreferences: known(
          Object.freeze([
            Object.freeze({
              foodName: 'Arroz',
              kind: FoodPreferenceKind.ACCEPTED,
              confidence: 0.95,
              occurrences: 5,
            }),
            ...(options.rejectedFood
              ? [
                  Object.freeze({
                    foodName: options.rejectedFood,
                    kind: FoodPreferenceKind.REJECTED,
                    confidence: 1,
                    occurrences: 2,
                  }),
                ]
              : []),
          ]),
        ),
      }),
      longitudinal: Object.freeze({
        adherenceScore: unknown<number>(),
        latestProgressWeightKg: unknown<number>(),
        goalProgression: unknown(),
        nutritionEvolution: unknown(),
        coachAdaptation: unknown(),
      }),
      plans: Object.freeze({
        currentDiet: unknown(),
        currentWorkout: options.workout
          ? known(
              Object.freeze({
                id: 'workout-id',
                title: 'Treino atual',
                objective: FitnessGoal.WEIGHT_LOSS,
                status: 'ACTIVE',
                generatedAt: '2026-07-15T12:00:00.000Z',
              }),
            )
          : unknown(),
      }),
      conversation: Object.freeze({
        preferredLanguage: known('pt-BR'),
        timezone: known('America/Sao_Paulo'),
        coachStyle: unknown(),
        behavioralStyle: unknown(),
        behavioralStage: unknown(),
        classifiedGoal: unknown(),
        memorySummaries: unknown<readonly string[]>(),
      }),
      completion: Object.freeze({
        overall: 'PARTIAL',
        sections: Object.freeze([]),
      }),
      conflicts: Object.freeze([]),
      referenceDate: referenceDate.toISOString(),
    });
  }

  function decision(
    goal: ConversationGoalDecision['goal'] = CONVERSATION_GOAL.GENERATE_DIET_PLAN,
  ): ConversationGoalDecision {
    return Object.freeze({
      recognizedIntent:
        goal === CONVERSATION_GOAL.GENERAL_GUIDANCE
          ? CONVERSATION_RECOGNIZED_INTENT.GENERAL_GUIDANCE_REQUEST
          : CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST,
      goal,
      reason:
        goal === CONVERSATION_GOAL.GENERAL_GUIDANCE
          ? 'GENERAL_GUIDANCE_REQUESTED'
          : 'DIET_PROFILE_READY',
      targetPlan: goal === CONVERSATION_GOAL.GENERAL_GUIDANCE ? null : 'DIET',
      profileCompletionState: 'PARTIAL',
      canExecute: true,
      confidence: 'HIGH',
      selectedProfileField: null,
      metPreconditions: Object.freeze([]),
      missingPreconditions: Object.freeze([]),
      pendingDependencies: Object.freeze([]),
    });
  }

  function buildContext(
    artifactType: NutritionArtifactType,
    profile = snapshot(),
  ) {
    return new NutritionPlanningContextBuilder().build({
      snapshot: profile,
      artifactType,
      referenceDate,
    });
  }

  function validDailyCandidate(): GeneratedNutritionPlanCandidate {
    const meals = ['breakfast', 'lunch', 'dinner'].map((key, index) =>
      Object.freeze({
        mealKey: `meal-${key}`,
        name: key,
        period: (['BREAKFAST', 'LUNCH', 'DINNER'] as const)[index],
        suggestedTime: (['08:00', '13:00', '20:00'] as const)[index],
        items: Object.freeze([
          Object.freeze({
            itemKey: `item-${key}`,
            foodName: `Arroz, feijão e frango ${index + 1}`,
            role: 'OTHER' as const,
            quantity: '1 porção',
            caloriesKcal: 650,
            macros: Object.freeze({
              proteinGrams: 33,
              carbohydrateGrams: 89,
              fatGrams: 18,
            }),
            allergenTags: Object.freeze([]),
            dietaryTags: Object.freeze([]),
          }),
        ]),
        alternatives: Object.freeze([]),
      }),
    );
    return Object.freeze({
      artifactType: NUTRITION_ARTIFACT_TYPE.DAILY_STRUCTURE,
      title: 'Estrutura diária',
      objectiveSummary: 'Estrutura estimada para emagrecimento gradual',
      guidance: Object.freeze([
        'Ajuste as porções conforme sinais de fome e saciedade.',
      ]),
      days: Object.freeze([
        Object.freeze({
          dayNumber: 1,
          label: 'Dia-base',
          trainingDay: false,
          meals: Object.freeze(meals),
        }),
      ]),
      substitutions: Object.freeze([]),
      adaptationRules: Object.freeze([]),
      hydrationGuidance: Object.freeze([]),
      safetyNotes: Object.freeze([]),
    });
  }

  function pointGuidanceCandidate(): NutritionConversationalCandidate {
    return Object.freeze({
      artifactType: 'POINT_GUIDANCE',
      title: 'Orientação pontual',
      summary: 'Uma orientação objetiva',
      guidance: Object.freeze({
        answer: 'Combine uma fonte de proteína com vegetais.',
        rationale: Object.freeze([]),
        actionableSteps: Object.freeze(['Escolha uma proteína.']),
        cautions: Object.freeze([]),
      }),
    });
  }

  async function engineWith(aiService: object) {
    const module = await Test.createTestingModule({
      providers: [
        NutritionPlanningEngineV2Service,
        NutritionGenerationRunnerV2Service,
        NutritionArtifactResolverService,
        NutritionPlanningReadinessService,
        NutritionPlanningContextBuilder,
        NutritionPlanningStrategyService,
        NutritionPlanningSafetyService,
        NutritionPlanV2Validator,
        NutritionConversationalArtifactValidator,
        {
          provide: AIUsageService,
          useValue: {
            estimateCost: jest
              .fn()
              .mockReturnValue({ toFixed: () => '0.00000001' }),
          },
        },
        { provide: AIService, useValue: aiService },
      ],
    }).compile();

    return module.get(NutritionPlanningEngineV2Service);
  }

  it('prepares Nutrition V2 without AIJob or provider side effects', async () => {
    const aiService = {
      createStandaloneJob: jest.fn(),
      runTextJob: jest.fn(),
      completeJobInTransaction: jest.fn(),
      failJob: jest.fn(),
    };
    const engine = await engineWith(aiService);

    const prepared = engine.prepare({
      userId: 'user-id',
      decision: decision(),
      snapshot: snapshot(),
      referenceDate,
      explicitArtifactType: 'DAILY_STRUCTURE',
    });

    expect(prepared.resolution.status).toBe('RESOLVED');
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(aiService.createStandaloneJob).not.toHaveBeenCalled();
    expect(aiService.runTextJob).not.toHaveBeenCalled();
    expect(aiService.completeJobInTransaction).not.toHaveBeenCalled();
    expect(aiService.failJob).not.toHaveBeenCalled();
  });

  it('resolves only explicit plan granularity and never classifies free text', () => {
    const resolver = new NutritionArtifactResolverService();
    expect(resolver.resolve({ decision: decision() })).toEqual({
      status: 'REQUIRES_CLARIFICATION',
      artifactType: null,
      reason: 'ARTIFACT_GRANULARITY_REQUIRED',
    });
    expect(
      resolver.resolve({
        decision: decision(),
        explicitArtifactType: NUTRITION_ARTIFACT_TYPE.WEEKLY_PLAN,
      }),
    ).toMatchObject({ status: 'RESOLVED', artifactType: 'WEEKLY_PLAN' });
  });

  it('evaluates readiness by artifact and blocks missing required profile data', () => {
    const service = new NutritionPlanningReadinessService();
    expect(
      service.evaluate(snapshot(), NUTRITION_ARTIFACT_TYPE.WEEKLY_PLAN, false)
        .status,
    ).toBe('READY');
    const incomplete = service.evaluate(
      snapshot({ missingAge: true }),
      NUTRITION_ARTIFACT_TYPE.WEEKLY_PLAN,
      false,
    );
    expect(incomplete.status).toBe('BLOCKED');
    expect(incomplete.missingFields).toContain('AGE');
    const custom = service.evaluate(
      snapshot({ customRestriction: 'Restrição familiar específica' }),
      NUTRITION_ARTIFACT_TYPE.DAILY_STRUCTURE,
      false,
    );
    expect(custom.status).toBe('REQUIRES_CONFIRMATION');
    expect(custom.safetyFlags).toContain(
      'CUSTOM_CONSTRAINT_REQUIRES_CONFIRMATION',
    );
  });

  it('accepts confirmed empty allergies for diet generation without relaxing the safety gate', () => {
    const service = new NutritionPlanningReadinessService();
    const complete = snapshot();
    const unconfirmed: CoachProfileSnapshot = Object.freeze({
      ...complete,
      restrictions: Object.freeze({
        ...complete.restrictions,
        allergies: Object.freeze({
          status: 'REQUIRES_CONFIRMATION',
          value: Object.freeze([]),
          sources: Object.freeze([COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE]),
        }),
      }),
    });

    const blocked = service.evaluate(unconfirmed, 'WEEKLY_PLAN', false);
    const ready = service.evaluate(complete, 'WEEKLY_PLAN', false);
    expect(blocked.status).toBe('REQUIRES_CONFIRMATION');
    expect(blocked.confirmationRequiredFields).toContain('ALLERGIES');
    expect(ready.status).toBe('READY');
    expect(ready.confirmationRequiredFields).not.toContain('ALLERGIES');
  });

  it('accepts known empty food restrictions without creating a constraint fact', () => {
    const profile = snapshot({ withoutFoodRestrictions: true });
    const readiness = new NutritionPlanningReadinessService().evaluate(
      profile,
      NUTRITION_ARTIFACT_TYPE.WEEKLY_PLAN,
      false,
    );
    const context = buildContext(NUTRITION_ARTIFACT_TYPE.WEEKLY_PLAN, profile);

    expect(readiness.status).toBe('READY');
    expect(readiness.safetyFlags).not.toContain(
      'CUSTOM_CONSTRAINT_REQUIRES_CONFIRMATION',
    );
    expect(readiness.confirmationRequiredFields).not.toContain(
      'FOOD_RESTRICTIONS',
    );
    expect(
      context.constraints.filter(
        (constraint) => constraint.kind === 'RESTRICTION',
      ),
    ).toEqual([]);
  });

  it('moves weekly nutrition readiness from blocked to ready with structured acquisition facts', () => {
    const service = new NutritionPlanningReadinessService();
    const complete = snapshot();
    const before: CoachProfileSnapshot = Object.freeze({
      ...complete,
      nutrition: Object.freeze({
        ...complete.nutrition,
        dietaryPattern: unknown<string>(),
        foodIntolerances: unknown(),
        declaredFoodPreferences: unknown(),
        declaredFoodRejections: unknown(),
        cookingAvailability: unknown<string>(),
        eatingOutFrequency: unknown<string>(),
        foodBudget: unknown<string>(),
        hydration: unknown<string>(),
      }),
    });
    const blocked = service.evaluate(before, 'WEEKLY_PLAN', false);
    const ready = service.evaluate(complete, 'WEEKLY_PLAN', false);
    expect(blocked.status).toBe('BLOCKED');
    expect(blocked.missingFields).toEqual(
      expect.arrayContaining([
        'EATING_PATTERN',
        'FOOD_INTOLERANCES',
        'DECLARED_FOOD_PREFERENCES',
        'DECLARED_FOOD_REJECTIONS',
        'COOKING_AVAILABILITY',
        'EATING_OUT_FREQUENCY',
        'FOOD_BUDGET',
        'HYDRATION',
      ]),
    );
    expect(ready.status).toBe('READY');
    const context = new NutritionPlanningContextBuilder().build({
      snapshot: complete,
      artifactType: 'WEEKLY_PLAN',
      referenceDate,
    });
    expect(context.routine).toMatchObject({
      eatingPattern: { status: 'CONFIRMED', value: 'OMNIVORE' },
      eatingOutFrequency: { status: 'CONFIRMED', value: 'SOMETIMES' },
      hydration: { status: 'CONFIRMED', value: 'ADEQUATE' },
    });
  });

  it('builds a sanitized deterministic context without technical ids or clinical content', () => {
    const builder = new NutritionPlanningContextBuilder();
    const context = builder.build({
      snapshot: snapshot({ medical: true }),
      artifactType: NUTRITION_ARTIFACT_TYPE.DAILY_STRUCTURE,
      referenceDate,
    });
    const serialized = JSON.stringify(context);
    expect(context.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'LACTOSE', status: 'CONFIRMED' }),
      ]),
    );
    expect(serialized).not.toContain('technical-user-id');
    expect(serialized).not.toContain('Acompanhamento clínico');
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.constraints)).toBe(true);
    expect(
      builder.build({
        snapshot: snapshot(),
        artifactType: 'DAILY_STRUCTURE',
        referenceDate,
      }),
    ).toEqual(
      builder.build({
        snapshot: snapshot(),
        artifactType: 'DAILY_STRUCTURE',
        referenceDate,
      }),
    );
  });

  it('neutralizes contaminated history and applies explicit and safety precedence per normalized food', () => {
    const base = snapshot();
    const profile = Object.freeze({
      ...base,
      nutrition: Object.freeze({
        ...base.nutrition,
        declaredFoodPreferences: known(Object.freeze([' Arroz '])),
        declaredFoodRejections: known(Object.freeze(['BANANA'])),
      }),
      restrictions: Object.freeze({
        ...base.restrictions,
        allergies: known(
          Object.freeze([
            Object.freeze({
              type: 'ALLERGY',
              description: 'Amendoim',
              source: COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE,
            }),
          ]),
        ),
      }),
      preferences: Object.freeze({
        foodPreferences: known(
          Object.freeze([
            Object.freeze({
              foodName: 'ARROZ',
              kind: FoodPreferenceKind.REJECTED,
              confidence: 0.9,
              occurrences: 2,
              evidenceSource: 'MEAL_HISTORY',
            }),
            Object.freeze({
              foodName: 'Banana',
              kind: FoodPreferenceKind.FREQUENT,
              confidence: 0.9,
              occurrences: 5,
              evidenceSource: 'MEAL_HISTORY',
            }),
            Object.freeze({
              foodName: 'AMENDOIM',
              kind: FoodPreferenceKind.FREQUENT,
              confidence: 0.9,
              occurrences: 5,
              evidenceSource: 'MEAL_HISTORY',
            }),
            Object.freeze({
              foodName: 'Bebida energética',
              kind: FoodPreferenceKind.ACCEPTED,
              confidence: 0.8,
              occurrences: 1,
              evidenceSource: 'MEAL_HISTORY',
            }),
            Object.freeze({
              foodName: 'Nenhuma restrição',
              kind: FoodPreferenceKind.AVOIDED,
              confidence: 0.98,
              occurrences: 1,
              evidenceSource: 'REGISTERED_RESTRICTION',
            }),
            Object.freeze({
              foodName: 'SYSTEM_DEFAULT',
              kind: FoodPreferenceKind.AVOIDED,
              confidence: 0.98,
              occurrences: 1,
              evidenceSource: 'REGISTERED_RESTRICTION',
            }),
          ]),
        ),
      }),
    });

    const context = buildContext('DAILY_STRUCTURE', profile);
    const strategy = new NutritionPlanningStrategyService().build(context);

    expect(context.preferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          foodName: 'Arroz',
          disposition: 'PREFERRED',
        }),
        expect.objectContaining({
          foodName: 'BANANA',
          disposition: 'REJECTED',
        }),
        expect.objectContaining({
          foodName: 'Amendoim',
          disposition: 'AVOIDED',
        }),
      ]),
    );
    expect(context.preferences).toHaveLength(4);
    expect(strategy.preferredFoods).toEqual(['Arroz']);
    expect(strategy.excludedFoods).toEqual(
      expect.arrayContaining(['Amendoim', 'BANANA', 'Sem lactose']),
    );
    expect(strategy.excludedFoods).not.toEqual(
      expect.arrayContaining(['Arroz', 'Nenhuma restrição', 'SYSTEM_DEFAULT']),
    );
  });

  it('inserts a safety allergy even without history or declared preference', () => {
    const base = snapshot({ withoutFoodRestrictions: true });
    const profile = Object.freeze({
      ...base,
      nutrition: Object.freeze({
        ...base.nutrition,
        declaredFoodPreferences: known(Object.freeze([])),
        declaredFoodRejections: known(Object.freeze([])),
      }),
      restrictions: Object.freeze({
        ...base.restrictions,
        allergies: known(
          Object.freeze([
            Object.freeze({
              type: 'ALLERGY',
              description: 'Amendoim',
              source: COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE,
            }),
          ]),
        ),
      }),
      preferences: Object.freeze({
        foodPreferences: known(Object.freeze([])),
      }),
    });

    const context = buildContext('DAILY_STRUCTURE', profile);
    const strategy = new NutritionPlanningStrategyService().build(context);

    expect(context.preferences).toContainEqual({
      foodName: 'Amendoim',
      disposition: 'AVOIDED',
      confidence: 1,
    });
    expect(strategy.excludedFoods).toEqual(['Amendoim']);
  });

  it('creates deterministic and personalized strategies for profiles A, B and C', () => {
    const service = new NutritionPlanningStrategyService();
    const strategyA = service.build(buildContext('DAILY_STRUCTURE'));
    const strategyB = service.build(
      buildContext('WEEKLY_PLAN', snapshot({ workout: true })),
    );
    const strategyC = service.build(
      buildContext('DAILY_STRUCTURE', snapshot({ rejectedFood: 'Banana' })),
    );
    expect(strategyA).toEqual(service.build(buildContext('DAILY_STRUCTURE')));
    expect(strategyA.energyTargetKcal).toEqual({
      status: 'ESTIMATED',
      value: 1950,
    });
    expect(strategyA.macroTargets.status).toBe('ESTIMATED');
    expect(strategyB).toMatchObject({
      dayCount: 7,
      trainingAware: true,
      variationPolicy: 'WEEKLY',
    });
    expect(strategyC.excludedFoods).toEqual(['Banana', 'Sem lactose']);
    expect(strategyA).not.toEqual(strategyB);
    expect(strategyA).not.toEqual(strategyC);
  });

  it('does not reinterpret desiredOutcome text inside the strategy', () => {
    const base = snapshot();
    const recomposition = Object.freeze({
      ...base,
      nutrition: Object.freeze({
        ...base.nutrition,
        primaryGoal: known(FitnessGoal.WEIGHT_LOSS),
        desiredOutcome: known('perder gordura e ganhar massa muscular'),
      }),
    });
    const context = buildContext('DAILY_STRUCTURE', recomposition);
    const strategy = new NutritionPlanningStrategyService().build(context);

    expect(strategy.objective).toEqual({
      status: 'CONFIRMED',
      value: FitnessGoal.WEIGHT_LOSS,
    });
    expect(strategy.energyTargetKcal).toEqual({
      status: 'ESTIMATED',
      value: 1950,
    });
    expect(context.profile.desiredOutcome).toEqual({
      status: 'CONFIRMED',
      value: 'perder gordura e ganhar massa muscular',
    });
    expect(strategy.macroTargets).toMatchObject({
      status: 'ESTIMATED',
      value: { proteinGrams: 98 },
    });
  });

  it('rejects forbidden foods, incoherent energy and orphan substitutions after generation', () => {
    const context = buildContext('DAILY_STRUCTURE');
    const strategy = new NutritionPlanningStrategyService().build(context);
    const validator = new NutritionPlanV2Validator();
    expect(
      validator.validate(validDailyCandidate(), context, strategy).status,
    ).toBe('VALID');
    const unsafe = validDailyCandidate();
    const firstDay = unsafe.days[0];
    const firstMeal = firstDay.meals[0];
    const firstItem = firstMeal.items[0];
    const invalid: GeneratedNutritionPlanCandidate = {
      ...unsafe,
      days: [
        {
          ...firstDay,
          meals: [
            {
              ...firstMeal,
              items: [
                {
                  ...firstItem,
                  foodName: 'Queijo com leite',
                  caloriesKcal: 2500,
                  allergenTags: ['LACTOSE'],
                },
              ],
            },
            ...firstDay.meals.slice(1),
          ],
        },
      ],
      substitutions: [
        {
          substitutionKey: 'orphan',
          sourceItemKey: 'missing',
          alternativeItemKey: 'also-missing',
          rationaleCode: 'VARIETY',
        },
      ],
    };
    const validation = validator.validate(invalid, context, strategy);
    expect(validation.status).toBe('INVALID');
    expect(validation.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'FORBIDDEN_CONSTRAINT',
        'EXTREME_VALUE',
        'ENERGY_INCOHERENT',
        'SUBSTITUTION_REFERENCE_INVALID',
      ]),
    );
  });

  it('validates a complete seven-day plan with stable daily structure', () => {
    const context = buildContext('WEEKLY_PLAN');
    const strategy = new NutritionPlanningStrategyService().build(context);
    const daily = validDailyCandidate().days[0];
    const weekly: GeneratedNutritionPlanCandidate = {
      ...validDailyCandidate(),
      artifactType: 'WEEKLY_PLAN',
      days: Array.from({ length: 7 }, (_, dayIndex) => ({
        ...daily,
        dayNumber: dayIndex + 1,
        label: `Dia ${dayIndex + 1}`,
        meals: daily.meals.map((meal) => ({
          ...meal,
          mealKey: `${meal.mealKey}-${dayIndex + 1}`,
          items: meal.items.map((item) => ({
            ...item,
            itemKey: `${item.itemKey}-${dayIndex + 1}`,
          })),
        })),
      })),
    };
    expect(
      new NutritionPlanV2Validator().validate(weekly, context, strategy),
    ).toEqual({ status: 'VALID', issues: [] });
  });

  it('parses strict candidates and rejects malformed model output', () => {
    const parser = new NutritionPlanV2Parser();
    expect(
      parser.parse(JSON.stringify(validDailyCandidate())).artifactType,
    ).toBe('DAILY_STRUCTURE');
    expect(() => parser.parse('{invalid')).toThrow('JSON inválido');
  });

  it('stops before AI on medical context and materializes a pure formatter', async () => {
    const aiService = {
      createStandaloneJob: jest.fn(),
      runTextJob: jest.fn(),
      completeJobInTransaction: jest.fn(),
      failJob: jest.fn(),
    };
    const engine = await engineWith(aiService);
    await expect(
      engine.generate({
        userId: 'user-id',
        decision: decision(),
        snapshot: snapshot({ medical: true }),
        referenceDate,
        explicitArtifactType: 'DAILY_STRUCTURE',
      }),
    ).rejects.toThrow('PROFESSIONAL_REVIEW_RECOMMENDED');
    expect(aiService.createStandaloneJob).not.toHaveBeenCalled();
    expect(new NutritionPlanV2Formatter()).toBeDefined();
  });

  it('returns every completion input while leaving the AI job pending', async () => {
    const candidate = pointGuidanceCandidate();
    const response = {
      responseId: 'response-id',
      model: 'text-model',
      outputText: JSON.stringify(candidate),
      promptTokens: 100,
      completionTokens: 80,
      totalTokens: 180,
    };
    const aiService = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'job-id',
        userId: 'user-id',
        type: AIJobType.DIET,
        status: AIJobStatus.PENDING,
        promptVersionId: 'prompt-version-id',
        providerResponseId: null,
        result: null,
      }),
      runTextJob: jest.fn().mockResolvedValue(response),
      completeJobInTransaction: jest.fn().mockResolvedValue({ id: 'usage-id' }),
      failJob: jest.fn().mockResolvedValue(undefined),
    };
    const engine = await engineWith(aiService);
    const result = await engine.generate({
      userId: 'user-id',
      decision: decision(CONVERSATION_GOAL.GENERAL_GUIDANCE),
      snapshot: snapshot(),
      referenceDate,
    });
    expect(result).toMatchObject({
      status: 'PENDING_COMPLETION',
      aiJobId: 'job-id',
      reused: false,
      operationKey: expect.stringMatching(/^nutrition-planning-v2:/),
      output: {
        kind: 'CONVERSATIONAL_ARTIFACT',
        artifact: { artifactType: 'POINT_GUIDANCE', schemaVersion: '1.0' },
      },
      storedResult: {
        candidateOutput: response.outputText,
        model: response.model,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.output)).toBe(true);
    expect(aiService.createStandaloneJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: AIJobType.DIET,
        operationKey: expect.stringMatching(/^nutrition-planning-v2:/),
      }),
    );
    const request = aiService.runTextJob.mock.calls[0][1];
    expect(request.input).not.toContain('user-id');
    expect(request.jsonSchema.name).toBe('nutrition_point_guidance_v1');
    expect(result.completion).toEqual({
      userId: 'user-id',
      aiJobId: 'job-id',
      jobType: AIJobType.DIET,
      response,
      result: {
        candidateOutput: response.outputText,
        model: response.model,
      },
    });
    expect(aiService.completeJobInTransaction).not.toHaveBeenCalled();
    expect(aiService.failJob).not.toHaveBeenCalled();
  });

  it('fails the AI job when parsing a fresh generation fails', async () => {
    const response = {
      responseId: 'response-id',
      model: 'text-model',
      outputText: '{invalid',
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
    };
    const aiService = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'job-id',
        status: AIJobStatus.PENDING,
        promptVersionId: 'prompt-version-id',
        result: null,
      }),
      runTextJob: jest.fn().mockResolvedValue(response),
      completeJobInTransaction: jest.fn(),
      failJob: jest.fn().mockResolvedValue(undefined),
    };
    const engine = await engineWith(aiService);

    await expect(
      engine.generate({
        userId: 'user-id',
        decision: decision(CONVERSATION_GOAL.GENERATE_DIET_PLAN),
        snapshot: snapshot(),
        referenceDate,
        explicitArtifactType: 'DAILY_STRUCTURE',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(aiService.failJob).toHaveBeenCalledWith(
      'job-id',
      expect.any(BadGatewayException),
      response,
    );
    expect(aiService.completeJobInTransaction).not.toHaveBeenCalled();
  });

  it('fails the AI job when the provider call fails', async () => {
    const providerError = new BadGatewayException('OpenAI indisponível');
    const aiService = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'job-id',
        status: AIJobStatus.PENDING,
        promptVersionId: 'prompt-version-id',
        result: null,
      }),
      runTextJob: jest.fn().mockRejectedValue(providerError),
      completeJobInTransaction: jest.fn(),
      failJob: jest.fn().mockResolvedValue(undefined),
    };
    const engine = await engineWith(aiService);

    await expect(
      engine.generate({
        userId: 'user-id',
        decision: decision(CONVERSATION_GOAL.GENERAL_GUIDANCE),
        snapshot: snapshot(),
        referenceDate,
      }),
    ).rejects.toBe(providerError);
    expect(aiService.failJob).toHaveBeenCalledWith(
      'job-id',
      providerError,
      undefined,
    );
    expect(aiService.completeJobInTransaction).not.toHaveBeenCalled();
  });

  it('fails the AI job when validation and post-generation safety reject the candidate', async () => {
    const response = {
      responseId: 'response-id',
      model: 'text-model',
      outputText: JSON.stringify({
        ...validDailyCandidate(),
        artifactType: 'WEEKLY_PLAN',
      }),
      promptTokens: 100,
      completionTokens: 80,
      totalTokens: 180,
    };
    const aiService = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'job-id',
        status: AIJobStatus.PENDING,
        promptVersionId: 'prompt-version-id',
        result: null,
      }),
      runTextJob: jest.fn().mockResolvedValue(response),
      completeJobInTransaction: jest.fn(),
      failJob: jest.fn().mockResolvedValue(undefined),
    };
    const engine = await engineWith(aiService);

    await expect(
      engine.generate({
        userId: 'user-id',
        decision: decision(CONVERSATION_GOAL.GENERATE_DIET_PLAN),
        snapshot: snapshot(),
        referenceDate,
        explicitArtifactType: 'DAILY_STRUCTURE',
      }),
    ).rejects.toThrow('Plano nutricional V2 reprovado');
    expect(aiService.failJob).toHaveBeenCalledWith(
      'job-id',
      expect.any(BadGatewayException),
      response,
    );
    expect(aiService.completeJobInTransaction).not.toHaveBeenCalled();
  });

  it('represents an idempotent completed job without fabricating completion metadata', async () => {
    const storedResult = {
      candidateOutput: JSON.stringify(pointGuidanceCandidate()),
      model: 'stored-model',
    };
    const aiService = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'completed-job-id',
        status: AIJobStatus.COMPLETED,
        promptVersionId: 'prompt-version-id',
        result: storedResult,
      }),
      runTextJob: jest.fn(),
      completeJobInTransaction: jest.fn(),
      failJob: jest.fn(),
    };
    const engine = await engineWith(aiService);

    const result = await engine.generate({
      userId: 'user-id',
      decision: decision(CONVERSATION_GOAL.GENERAL_GUIDANCE),
      snapshot: snapshot(),
      referenceDate,
    });

    expect(result).toMatchObject({
      status: 'ALREADY_COMPLETED',
      aiJobId: 'completed-job-id',
      reused: true,
      completion: null,
      storedResult,
      output: {
        kind: 'CONVERSATIONAL_ARTIFACT',
        artifact: { artifactType: 'POINT_GUIDANCE' },
      },
    });
    expect(aiService.runTextJob).not.toHaveBeenCalled();
    expect(aiService.completeJobInTransaction).not.toHaveBeenCalled();
    expect(aiService.failJob).not.toHaveBeenCalled();
  });

  it('does not reclaim or fail an idempotent Nutrition job already processing', async () => {
    const aiService = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'processing-job-id',
        status: AIJobStatus.PROCESSING,
        promptVersionId: 'prompt-version-id',
        result: null,
      }),
      runTextJob: jest.fn(),
      completeJobInTransaction: jest.fn(),
      failJob: jest.fn(),
    };
    const engine = await engineWith(aiService);

    await expect(
      engine.generateCandidate({
        userId: 'user-id',
        decision: decision(CONVERSATION_GOAL.GENERAL_GUIDANCE),
        snapshot: snapshot(),
        referenceDate,
      }),
    ).rejects.toThrow('em andamento');
    expect(aiService.runTextJob).not.toHaveBeenCalled();
    expect(aiService.completeJobInTransaction).not.toHaveBeenCalled();
    expect(aiService.failJob).not.toHaveBeenCalled();
  });

  it('generates meal suggestions directly as conversational artifacts', async () => {
    const candidate = {
      artifactType: 'MEAL_SUGGESTION',
      title: 'Almoço',
      summary: 'Sugestão isolada',
      meal: {
        name: 'Prato brasileiro',
        mealType: 'LUNCH',
        description: 'Refeição equilibrada',
        items: [
          { name: 'Arroz', quantity: 100, unit: 'g', preparationNotes: null },
        ],
        estimatedNutrition: {
          caloriesKcal: 400,
          proteinGrams: 20,
          carbohydrateGrams: 50,
          fatGrams: 10,
        },
        alternatives: [],
      },
    };
    const response = {
      responseId: 'meal-response',
      model: 'model',
      outputText: JSON.stringify(candidate),
      promptTokens: 10,
      completionTokens: 10,
      totalTokens: 20,
    };
    const aiService = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'meal-job',
        status: AIJobStatus.PENDING,
        promptVersionId: 'prompt-id',
        result: null,
      }),
      runTextJob: jest.fn().mockResolvedValue(response),
      failJob: jest.fn(),
    };
    const result = await (
      await engineWith(aiService)
    ).generate({
      userId: 'user-id',
      decision: decision(CONVERSATION_GOAL.GENERATE_DIET_PLAN),
      snapshot: snapshot(),
      referenceDate,
      explicitArtifactType: 'MEAL_SUGGESTION',
    });
    expect(result).toMatchObject({
      status: 'PENDING_COMPLETION',
      output: {
        kind: 'CONVERSATIONAL_ARTIFACT',
        artifact: {
          artifactType: 'MEAL_SUGGESTION',
          meal: { name: 'Prato brasileiro' },
        },
      },
    });
    expect(aiService.runTextJob.mock.calls[0][1].jsonSchema.name).toBe(
      'nutrition_meal_suggestion_v1',
    );
  });

  it('injects the trusted persistent plan id into plan reviews', async () => {
    const candidate = {
      artifactType: 'PLAN_REVIEW',
      title: 'Revisão',
      summary: 'Análise do plano',
      review: {
        overallAssessment: 'Adequado',
        strengths: ['Variedade'],
        concerns: [],
        recommendations: [],
      },
    };
    const response = {
      responseId: 'review-response',
      model: 'model',
      outputText: JSON.stringify(candidate),
      promptTokens: 10,
      completionTokens: 10,
      totalTokens: 20,
    };
    const aiService = {
      createStandaloneJob: jest.fn().mockResolvedValue({
        id: 'review-job',
        status: AIJobStatus.PENDING,
        promptVersionId: 'prompt-id',
        result: null,
      }),
      runTextJob: jest.fn().mockResolvedValue(response),
      failJob: jest.fn(),
    };
    const base = validDailyCandidate();
    const plan: NutritionPlanV2 = {
      ...base,
      schemaVersion: 2,
      lifecycleReason: 'CREATION',
      replacesPlanReference: null,
      strategy: new NutritionPlanningStrategyService().build(
        buildContext('DAILY_STRUCTURE'),
      ),
      generation: {
        engineVersion: 2,
        promptVersionId: 'old-prompt',
        aiJobId: 'old-job',
        operationKey: 'old-operation',
        model: 'model',
        generatedAt: referenceDate.toISOString(),
        reused: false,
      },
      validation: { status: 'VALID', issues: [] },
    };
    const reviewSnapshot: CoachProfileSnapshot = Object.freeze({
      ...snapshot(),
      plans: Object.freeze({
        currentDiet: known(
          Object.freeze({
            id: 'persisted-plan-id',
            title: plan.title,
            objective: FitnessGoal.WEIGHT_LOSS,
            status: DietPlanStatus.ACTIVE,
            generatedAt: plan.generation.generatedAt,
          }),
        ),
        currentWorkout: unknown(),
      }),
    });
    const result = await (
      await engineWith(aiService)
    ).generate({
      userId: 'user-id',
      decision: decision(CONVERSATION_GOAL.UPDATE_DIET_PLAN),
      snapshot: reviewSnapshot,
      referenceDate,
      explicitArtifactType: 'PLAN_REVIEW',
      reviewedPlan: { id: 'persisted-plan-id', plan },
    });
    expect(result).toMatchObject({
      output: {
        kind: 'CONVERSATIONAL_ARTIFACT',
        artifact: {
          artifactType: 'PLAN_REVIEW',
          reviewedPlanId: 'persisted-plan-id',
        },
      },
    });
    expect(aiService.runTextJob.mock.calls[0][1].input).toContain(
      'persisted-plan-id',
    );
  });

  it('returns current-plan presentation without creating or running an AIJob', async () => {
    const aiService = {
      createStandaloneJob: jest.fn(),
      runTextJob: jest.fn(),
      failJob: jest.fn(),
    };
    const result = await (
      await engineWith(aiService)
    ).generate({
      userId: 'user-id',
      decision: decision(CONVERSATION_GOAL.SHOW_CURRENT_PLAN),
      snapshot: snapshot(),
      referenceDate,
    });
    expect(result).toEqual({
      status: 'NO_GENERATION',
      output: {
        kind: 'CURRENT_PLAN_PRESENTATION',
        artifactType: 'CURRENT_PLAN_PRESENTATION',
      },
    });
    expect(aiService.createStandaloneJob).not.toHaveBeenCalled();
    expect(aiService.runTextJob).not.toHaveBeenCalled();
  });
});
