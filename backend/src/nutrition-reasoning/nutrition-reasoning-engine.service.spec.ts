import {
  ActivityLevel,
  FitnessGoal,
  FoodPreferenceKind,
  Gender,
} from '@prisma/client';
import {
  COACH_PROFILE_DATA_SOURCE,
  type CoachProfileConstraint,
  type CoachProfileDatum,
  type CoachProfileSnapshot,
} from '../context/coach-profile-snapshot.contract';
import {
  CONVERSATION_GOAL,
  CONVERSATION_RECOGNIZED_INTENT,
  type ConversationGoalDecision,
} from '../context/conversation-goal-planner.contract';
import {
  NUTRITION_ARTIFACT_TYPE,
  type NutritionArtifactType,
} from '../diet/v2/nutrition-planning-artifact.contract';
import { NutritionKnowledgeResolverService } from '../nutrition-knowledge/nutrition-knowledge-resolver.service';
import {
  NUTRITION_REASONING_CONFLICT as C,
  NUTRITION_REASONING_OBJECTIVE as O,
  NUTRITION_REASONING_STRATEGY_VERSION,
  NUTRITION_REASONING_STRATEGY as S,
  type NutritionReasoningResult,
} from './nutrition-reasoning.contract';
import { NutritionReasoningEngineService } from './nutrition-reasoning-engine.service';

describe('NutritionReasoningEngineService', () => {
  interface SnapshotOptions {
    readonly goal?: FitnessGoal;
    readonly modality?: string;
    readonly dietaryPattern?: string;
    readonly constraints?: readonly string[];
    readonly budget?: string;
    readonly cookingAvailability?: string;
    readonly mealsAwayFromHome?: boolean;
    readonly eatingOutFrequency?: string;
    readonly hydration?: string;
    readonly preferredFoods?: readonly string[];
    readonly rejectedFoods?: readonly string[];
    readonly medicalConditions?: readonly string[];
    readonly ageYears?: number;
    readonly adherenceScore?: number;
    readonly experienceLevel?: string;
    readonly intensityPreference?: string;
    readonly weeklyFrequency?: number;
    readonly sessionDurationMinutes?: number;
    readonly desiredOutcome?: string;
  }

  const knowledgeResolver = new NutritionKnowledgeResolverService();
  const engine = new NutritionReasoningEngineService();
  const referenceDate = '2026-07-16T12:00:00.000Z';

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

  function constraint(description: string): CoachProfileConstraint {
    return Object.freeze({
      type: 'DECLARED',
      description,
      source: COACH_PROFILE_DATA_SOURCE.USER,
    });
  }

  function snapshot(options: SnapshotOptions = {}): CoachProfileSnapshot {
    const preferences = [
      ...(options.preferredFoods ?? []).map((foodName) =>
        Object.freeze({
          foodName,
          kind: FoodPreferenceKind.ACCEPTED,
          confidence: 1,
          occurrences: 1,
        }),
      ),
      ...(options.rejectedFoods ?? []).map((foodName) =>
        Object.freeze({
          foodName,
          kind: FoodPreferenceKind.REJECTED,
          confidence: 1,
          occurrences: 1,
        }),
      ),
    ];
    return Object.freeze({
      identity: Object.freeze({
        userId: known('technical-user-id'),
        displayName: known('Ana'),
        onboardingCompleted: known(true),
      }),
      physical: Object.freeze({
        sex: known(Gender.FEMALE),
        birthDate: known('1991-01-01'),
        ageYears: known(options.ageYears ?? 35),
        heightCm: known(165),
        currentWeightKg: known(70),
        targetWeightKg: known(64),
        activityLevel: known(ActivityLevel.MODERATE),
      }),
      nutrition: Object.freeze({
        primaryGoal: known(options.goal ?? FitnessGoal.MAINTENANCE),
        desiredOutcome: known(options.desiredOutcome ?? 'Rotina sustentável'),
        desiredMealCount: known(3),
        dietaryPattern: known(options.dietaryPattern ?? 'OMNIVORE'),
        foodIntolerances: known(
          Object.freeze((options.constraints ?? []).map(constraint)),
        ),
        declaredFoodPreferences: known(
          Object.freeze([...(options.preferredFoods ?? [])]),
        ),
        declaredFoodRejections: known(
          Object.freeze([...(options.rejectedFoods ?? [])]),
        ),
        cookingAvailability: known(options.cookingAvailability ?? 'MODERATE'),
        mealsAwayFromHome: known(options.mealsAwayFromHome ?? false),
        eatingOutFrequency: known(options.eatingOutFrequency ?? 'SOMETIMES'),
        foodBudget: known(options.budget ?? 'MODERATE'),
        supplementation: unknown<readonly string[]>(),
        hydration: known(options.hydration ?? 'ADEQUATE'),
      }),
      training: Object.freeze({
        primaryGoal: known(options.goal ?? FitnessGoal.MAINTENANCE),
        experienceLevel:
          options.experienceLevel === undefined
            ? unknown<string>()
            : known(options.experienceLevel),
        preferredModality: options.modality
          ? known(options.modality)
          : unknown<string>(),
        weeklyFrequency:
          options.weeklyFrequency === undefined
            ? unknown<number>()
            : known(options.weeklyFrequency),
        sessionDurationMinutes:
          options.sessionDurationMinutes === undefined
            ? unknown<number>()
            : known(options.sessionDurationMinutes),
        environment: unknown<string>(),
        availableEquipment: unknown<readonly string[]>(),
        perceivedConditioning: unknown<string>(),
        intensityPreference:
          options.intensityPreference === undefined
            ? unknown<string>()
            : known(options.intensityPreference),
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
        foodRestrictions: known(Object.freeze([])),
        allergies: known(Object.freeze([])),
        medicalConditions: known(
          Object.freeze((options.medicalConditions ?? []).map(constraint)),
        ),
        physicalLimitations: known(Object.freeze([])),
      }),
      preferences: Object.freeze({
        foodPreferences: known(Object.freeze(preferences)),
      }),
      longitudinal: Object.freeze({
        adherenceScore:
          options.adherenceScore === undefined
            ? unknown<number>()
            : known(options.adherenceScore),
        latestProgressWeightKg: unknown<number>(),
        goalProgression: unknown(),
        nutritionEvolution: unknown(),
        coachAdaptation: unknown(),
      }),
      plans: Object.freeze({
        currentDiet: unknown(),
        currentWorkout: unknown(),
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
      referenceDate,
    });
  }

  function goalDecision(
    goal: ConversationGoalDecision['goal'] = CONVERSATION_GOAL.GENERATE_DIET_PLAN,
  ): ConversationGoalDecision {
    const general = goal === CONVERSATION_GOAL.GENERAL_GUIDANCE;
    return Object.freeze({
      recognizedIntent: general
        ? CONVERSATION_RECOGNIZED_INTENT.GENERAL_GUIDANCE_REQUEST
        : CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST,
      goal,
      reason: general ? 'GENERAL_GUIDANCE_REQUESTED' : 'DIET_PROFILE_READY',
      targetPlan: general ? null : 'DIET',
      profileCompletionState: 'PARTIAL',
      canExecute: true,
      confidence: 'HIGH',
      selectedProfileField: null,
      metPreconditions: Object.freeze([]),
      missingPreconditions: Object.freeze([]),
      pendingDependencies: Object.freeze([]),
    });
  }

  function reason(
    options: SnapshotOptions,
    artifactType: NutritionArtifactType = NUTRITION_ARTIFACT_TYPE.WEEKLY_PLAN,
    goal: ConversationGoalDecision['goal'] = CONVERSATION_GOAL.GENERATE_DIET_PLAN,
  ): NutritionReasoningResult {
    const profile = snapshot(options);
    const knowledge = knowledgeResolver.resolve(profile);
    return engine.reason({
      snapshot: profile,
      knowledgePackages: knowledge.packages,
      conversationGoal: goalDecision(goal),
      artifactType,
    });
  }

  function strategy(
    result: NutritionReasoningResult,
    strategyId: NutritionReasoningResult['selectedStrategies'][number]['strategy'],
  ) {
    return result.selectedStrategies.find(
      (item) => item.strategy === strategyId,
    );
  }

  it('prioriza saciedade e densidade energética no emagrecimento', () => {
    const result = reason({ goal: FitnessGoal.WEIGHT_LOSS });
    expect(result.prioritizedObjectives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          objective: O.WEIGHT_REDUCTION,
          priority: 'HIGH',
        }),
        expect.objectContaining({ objective: O.SATIETY, priority: 'HIGH' }),
      ]),
    );
    expect(strategy(result, S.ENERGY_DENSITY)?.priority).toBe('HIGH');
    expect(strategy(result, S.SATIETY_SUPPORT)?.priority).toBe('HIGH');
    expect(result.prohibitedStrategies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ strategy: S.AGGRESSIVE_RESTRICTION }),
      ]),
    );
  });

  it('resolve hipertrofia com baixo orçamento e pouco tempo', () => {
    const result = reason({
      goal: FitnessGoal.MUSCLE_GAIN,
      budget: 'LOW',
      cookingAvailability: 'LIMITED',
    });
    expect(result.resolvedConflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ conflict: C.HYPERTROPHY_LOW_BUDGET }),
        expect.objectContaining({ conflict: C.PRACTICALITY_VARIETY }),
      ]),
    );
    expect(strategy(result, S.PROTEIN_PRIORITY)?.priority).toBe('HIGH');
    expect(strategy(result, S.ECONOMIC_SELECTION)?.priority).toBe('HIGH');
    expect(strategy(result, S.FOOD_SUBSTITUTION)?.priority).toBe('HIGH');
    expect(strategy(result, S.QUICK_MEALS)?.priority).toBe('HIGH');
    expect(result.prohibitedStrategies.map((item) => item.strategy)).toEqual(
      expect.arrayContaining([
        S.SOPHISTICATED_RECIPES,
        S.EXTENSIVE_VARIETY,
        S.HIGH_COST_DEFAULTS,
      ]),
    );
    expect(strategy(result, S.CONTROLLED_VARIETY)?.priority).toBe('LOW');
    expect(result.recommendedComplexity).toBe('SIMPLE');
  });

  it('mantém equilíbrio e maior variedade na manutenção com orçamento alto', () => {
    const result = reason({
      goal: FitnessGoal.MAINTENANCE,
      budget: 'HIGH',
    });
    expect(result.prioritizedObjectives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ objective: O.WEIGHT_MAINTENANCE }),
        expect.objectContaining({ objective: O.ECONOMY, priority: 'LOW' }),
      ]),
    );
    expect(strategy(result, S.ENERGY_BALANCE)?.priority).toBe('HIGH');
    expect(strategy(result, S.CONTROLLED_VARIETY)?.priority).toBe('HIGH');
    expect(result.recommendedComplexity).toBe('DETAILED');
  });

  it('eleva hidratação na corrida quando inadequada', () => {
    const result = reason({ modality: 'corrida', hydration: 'INADEQUATE' });
    expect(result.resolvedConflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ conflict: C.RUNNING_INADEQUATE_HYDRATION }),
      ]),
    );
    expect(strategy(result, S.HYDRATION_SUPPORT)?.priority).toBe('CRITICAL');
    expect(result.priorities.performance).toBe('HIGH');
    expect(result.priorities.recovery).toBe('HIGH');
  });

  it('estrutura performance e recuperação no ciclismo com hidratação adequada', () => {
    const result = reason({ modality: 'ciclismo', hydration: 'ADEQUATE' });
    expect(strategy(result, S.SPORTS_FUELING)?.priority).toBe('HIGH');
    expect(strategy(result, S.RECOVERY_SUPPORT)?.priority).toBe('HIGH');
    expect(strategy(result, S.HYDRATION_SUPPORT)?.priority).toBe('HIGH');
    expect(result.resolvedConflicts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ conflict: C.RUNNING_INADEQUATE_HYDRATION }),
      ]),
    );
  });

  it('combina combustível esportivo e refeições rápidas no CrossFit', () => {
    const result = reason({
      modality: 'CrossFit',
      cookingAvailability: 'pouco tempo',
    });
    expect(result.resolvedConflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ conflict: C.CROSSFIT_LIMITED_TIME }),
      ]),
    );
    expect(strategy(result, S.SPORTS_FUELING)?.priority).toBe('HIGH');
    expect(strategy(result, S.QUICK_MEALS)?.priority).toBe('HIGH');
  });

  it.each([
    ['vegetariano', 'MEDIUM'],
    ['vegano', 'HIGH'],
  ] as const)(
    'prioriza proteína e substituições no padrão %s',
    (dietaryPattern, proteinPriority) => {
      const result = reason({ dietaryPattern });
      expect(strategy(result, S.PROTEIN_PRIORITY)?.priority).toBe(
        proteinPriority,
      );
      expect(strategy(result, S.FOOD_SUBSTITUTION)?.priority).toBe('HIGH');
      if (dietaryPattern === 'vegano') {
        expect(result.resolvedConflicts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ conflict: C.VEGAN_PROTEIN }),
          ]),
        );
      }
    },
  );

  it('prioriza aderência, saciedade e educação no emagrecimento fora de casa', () => {
    const result = reason({
      goal: FitnessGoal.WEIGHT_LOSS,
      mealsAwayFromHome: true,
      eatingOutFrequency: 'FREQUENT',
      adherenceScore: 42,
    });
    expect(result.resolvedConflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conflict: C.WEIGHT_LOSS_EATING_OUT_LOW_ADHERENCE,
        }),
      ]),
    );
    expect(result.priorities.adherence).toBe('CRITICAL');
    expect(result.priorities.education).toBe('HIGH');
    expect(strategy(result, S.EATING_OUT_NAVIGATION)?.priority).toBe('HIGH');
    expect(result.interventionIntensity).toBe('LOW');
    expect(result.recommendedComplexity).toBe('SIMPLE');
  });

  it('reduz prioridade comportamental quando a aderência é alta', () => {
    const result = reason({ adherenceScore: 91 });
    expect(result.priorities.adherence).toBe('LOW');
    expect(result.priorities.behavior).toBe('LOW');
    expect(strategy(result, S.BEHAVIOR_ADHERENCE)?.priority).toBe('LOW');
  });

  it('resolve rejeições com orçamento baixo por substituição econômica', () => {
    const result = reason({ budget: 'baixo', rejectedFoods: ['coentro'] });
    expect(result.resolvedConflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ conflict: C.REJECTIONS_LOW_BUDGET }),
      ]),
    );
    expect(strategy(result, S.FOOD_SUBSTITUTION)?.priority).toBe('HIGH');
    expect(strategy(result, S.ECONOMIC_SELECTION)?.priority).toBe('HIGH');
  });

  it('simplifica quando existem muitas restrições e preserva todas como obrigatórias', () => {
    const result = reason({
      constraints: ['lactose', 'glúten', 'soja'],
    });
    expect(result.recommendedComplexity).toBe('SIMPLE');
    expect(strategy(result, S.CONSTRAINT_PRESERVATION)?.priority).toBe(
      'CRITICAL',
    );
    expect(result.appliedRestrictions.map((item) => item.code)).toContain(
      'PRESERVE_CONFIRMED_RESTRICTIONS',
    );
  });

  it('mantém complexidade detalhada com uma única restrição conhecida', () => {
    const result = reason({ constraints: ['lactose'] });
    expect(result.recommendedComplexity).toBe('DETAILED');
    expect(strategy(result, S.CONSTRAINT_PRESERVATION)?.priority).toBe(
      'CRITICAL',
    );
  });

  it('restringe intervenção e proíbe protocolo em contexto clínico', () => {
    const result = reason({ medicalConditions: ['Diabetes'] });
    expect(result.interventionIntensity).toBe('RESTRICTED');
    expect(result.metadata.safetyRestricted).toBe(true);
    expect(result.prohibitedStrategies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ strategy: S.CLINICAL_PROTOCOL }),
      ]),
    );
    expect(result.prioritizedObjectives[0]).toEqual(
      expect.objectContaining({ objective: O.SAFETY, primary: true }),
    );
  });

  it('reduz complexidade e intensidade para orientação pontual', () => {
    const result = reason(
      {},
      NUTRITION_ARTIFACT_TYPE.POINT_GUIDANCE,
      CONVERSATION_GOAL.GENERAL_GUIDANCE,
    );
    expect(result.recommendedComplexity).toBe('MINIMAL');
    expect(result.interventionIntensity).toBe('LOW');
    expect(result.priorities.education).toBe('HIGH');
  });

  it('combina múltiplos objetivos, conflitos, restrições e estratégias sem perder precedência', () => {
    const result = reason({
      goal: FitnessGoal.MUSCLE_GAIN,
      modality: 'CrossFit',
      budget: 'LOW',
      cookingAvailability: 'LIMITED',
      rejectedFoods: ['coentro'],
      constraints: ['lactose', 'glúten', 'soja'],
      adherenceScore: 38,
    });

    expect(result.prioritizedObjectives.map((item) => item.objective)).toEqual(
      expect.arrayContaining([
        O.SAFETY,
        O.MUSCLE_DEVELOPMENT,
        O.ADHERENCE,
        O.PERFORMANCE,
        O.RECOVERY,
        O.PRACTICALITY,
        O.ECONOMY,
      ]),
    );
    expect(result.resolvedConflicts.map((item) => item.conflict)).toEqual(
      expect.arrayContaining([
        C.HYPERTROPHY_LOW_BUDGET,
        C.CROSSFIT_LIMITED_TIME,
        C.REJECTIONS_LOW_BUDGET,
        C.PRACTICALITY_VARIETY,
      ]),
    );
    expect(result.appliedRestrictions.length).toBeGreaterThan(3);
    expect(result.selectedStrategies.length).toBeGreaterThan(5);
    expect(result.interventionIntensity).toBe('LOW');
    expect(result.recommendedComplexity).toBe('SIMPLE');
    expect(result.personalizationLevel).toBe('HIGH');
  });

  it('eleva personalização por sinais independentes de experiência e carga', () => {
    const baseline = reason({});
    const advanced = reason({
      experienceLevel: 'ADVANCED',
      intensityPreference: 'HIGH',
      weeklyFrequency: 6,
      sessionDurationMinutes: 90,
    });

    expect(baseline.personalizationLevel).toBe('CONTEXTUAL');
    expect(advanced.personalizationLevel).toBe('HIGH');
    expect(advanced.metadata.strategyVersion).toBe(
      NUTRITION_REASONING_STRATEGY_VERSION,
    );
  });

  it('materializa múltiplos packages esportivos novos em estratégias canônicas', () => {
    const result = reason({
      desiredOutcome: 'recomposição corporal',
      modality: 'treino híbrido',
      experienceLevel: 'avançado',
      sessionDurationMinutes: 90,
      intensityPreference: 'alta',
    });

    expect(result.selectedStrategies.map((item) => item.strategy)).toEqual(
      expect.arrayContaining([
        S.ENERGY_BALANCE,
        S.PROTEIN_DISTRIBUTION,
        S.SPORTS_FUELING,
        S.RECOVERY_SUPPORT,
        S.HYDRATION_SUPPORT,
      ]),
    );
    expect(result.prioritizedObjectives.map((item) => item.objective)).toEqual(
      expect.arrayContaining([O.PERFORMANCE, O.RECOVERY]),
    );
    expect(result.personalizationLevel).toBe('HIGH');
  });

  it('faz safety prevalecer sobre conhecimento esportivo em condição clínica estruturada', () => {
    const result = reason({
      modality: 'endurance',
      sessionDurationMinutes: 90,
      medicalConditions: ['Doença renal crônica'],
    });

    expect(result.metadata.safetyRestricted).toBe(true);
    expect(result.interventionIntensity).toBe('RESTRICTED');
    expect(result.recommendedComplexity).toBe('SIMPLE');
    expect(result.prohibitedStrategies.map((item) => item.strategy)).toEqual(
      expect.arrayContaining([S.CLINICAL_PROTOCOL, S.AGGRESSIVE_RESTRICTION]),
    );
    expect(result.selectedStrategies.map((item) => item.strategy)).toContain(
      S.CONSTRAINT_PRESERVATION,
    );
  });

  it('reduz complexidade para iniciante com baixa aderência sem perder educação', () => {
    const result = reason({
      experienceLevel: 'iniciante',
      adherenceScore: 35,
      cookingAvailability: 'pouco tempo',
    });

    expect(result.recommendedComplexity).toBe('SIMPLE');
    expect(result.priorities.adherence).toBe('CRITICAL');
    expect(result.prohibitedStrategies.map((item) => item.strategy)).toContain(
      S.SOPHISTICATED_RECIPES,
    );
    expect(result.selectedStrategies.map((item) => item.strategy)).toContain(
      S.BEHAVIOR_ADHERENCE,
    );
  });

  it('é determinístico, não modifica entradas e congela profundamente o resultado', () => {
    const profile = snapshot({
      goal: FitnessGoal.MUSCLE_GAIN,
      modality: 'CrossFit',
      budget: 'LOW',
      cookingAvailability: 'LOW',
    });
    const packages = knowledgeResolver.resolve(profile).packages;
    const input = Object.freeze({
      snapshot: profile,
      knowledgePackages: packages,
      conversationGoal: goalDecision(),
      artifactType: NUTRITION_ARTIFACT_TYPE.WEEKLY_PLAN,
    });
    const before = JSON.stringify(input);
    const first = engine.reason(input);
    const second = engine.reason(input);

    expect(first).toEqual(second);
    expect(JSON.stringify(input)).toBe(before);
    expectDeeplyFrozen(first);
    expect(first.metadata.deterministic).toBe(true);
  });

  it('aceita exclusivamente pacotes canônicos da Macro Q', () => {
    const profile = snapshot();
    const packages = knowledgeResolver.resolve(profile).packages;
    const duplicated = Object.freeze([...packages, packages[0]]);
    expect(() =>
      engine.reason({
        snapshot: profile,
        knowledgePackages: duplicated,
        conversationGoal: goalDecision(),
        artifactType: NUTRITION_ARTIFACT_TYPE.WEEKLY_PLAN,
      }),
    ).toThrow('Pacote nutricional duplicado');
    expect(NutritionReasoningEngineService.length).toBe(0);
  });

  it('não gera refeições, cardápios ou texto destinado ao usuário', () => {
    const result = reason({ goal: FitnessGoal.WEIGHT_LOSS });
    expect(Object.keys(result)).not.toEqual(
      expect.arrayContaining(['meals', 'days', 'menu', 'message', 'text']),
    );
    expect(
      result.selectedStrategies.every((item) =>
        /^[A-Z_]+$/.test(item.strategy),
      ),
    ).toBe(true);
    expect(
      result.prioritizedObjectives.every((item) =>
        /^[A-Z_]+$/.test(item.objective),
      ),
    ).toBe(true);
  });
});

function expectDeeplyFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeeplyFrozen(nested);
}
