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
import { NUTRITION_KNOWLEDGE_PACKAGES } from './nutrition-knowledge.catalog';
import {
  NUTRITION_KNOWLEDGE_CATALOG_VERSION,
  NUTRITION_KNOWLEDGE_PACKAGE_ID as P,
  NUTRITION_KNOWLEDGE_SCHEMA_VERSION,
  type NutritionKnowledgePackageId,
} from './nutrition-knowledge.contract';
import { NutritionKnowledgeResolverService } from './nutrition-knowledge-resolver.service';

describe('NutritionKnowledgeResolverService', () => {
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
    readonly desiredOutcome?: string;
    readonly experienceLevel?: string;
    readonly sessionDurationMinutes?: number;
    readonly intensityPreference?: string;
    readonly activityLevel?: ActivityLevel;
    readonly trainingTime?: string;
    readonly mealTimes?: readonly string[];
  }

  const resolver = new NutritionKnowledgeResolverService();
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
        activityLevel: known(options.activityLevel ?? ActivityLevel.MODERATE),
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
        experienceLevel: options.experienceLevel
          ? known(options.experienceLevel)
          : unknown<string>(),
        preferredModality: options.modality
          ? known(options.modality)
          : unknown<string>(),
        weeklyFrequency: unknown<number>(),
        sessionDurationMinutes:
          options.sessionDurationMinutes === undefined
            ? unknown<number>()
            : known(options.sessionDurationMinutes),
        environment: unknown<string>(),
        availableEquipment: unknown<readonly string[]>(),
        perceivedConditioning: unknown<string>(),
        intensityPreference: options.intensityPreference
          ? known(options.intensityPreference)
          : unknown<string>(),
        cardioAvailability: unknown<boolean>(),
        trainingFormatPreference: unknown<string>(),
      }),
      routine: Object.freeze({
        wakeUpTime: known('07:00'),
        sleepTime: known('23:00'),
        trainingTime: known(options.trainingTime ?? '18:30'),
        mealTimes: known(
          Object.freeze(options.mealTimes ?? ['08:00', '13:00', '20:00']),
        ),
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

  function expectPackages(
    options: SnapshotOptions,
    expected: readonly NutritionKnowledgePackageId[],
  ): void {
    const result = resolver.resolve(snapshot(options));
    for (const packageId of expected) {
      expect(result.packageIds).toContain(packageId);
    }
  }

  it.each([
    [FitnessGoal.WEIGHT_LOSS, P.WEIGHT_LOSS],
    [FitnessGoal.MUSCLE_GAIN, P.HYPERTROPHY],
    [FitnessGoal.MAINTENANCE, P.MAINTENANCE],
  ] as const)('resolve o objetivo %s', (goal, packageId) => {
    expectPackages({ goal }, [packageId]);
  });

  it.each([
    ['corrida de rua', P.RUNNING],
    ['ciclismo', P.CYCLING],
    ['CrossFit', P.CROSSFIT],
  ] as const)('resolve a modalidade %s', (modality, packageId) => {
    expectPackages({ modality }, [
      packageId,
      P.SPORTS_NUTRITION_FOUNDATION,
      P.MEAL_TIMING,
      P.HYDRATION,
    ]);
  });

  it.each([
    ['vegetariano', P.VEGETARIAN],
    ['vegano', P.VEGAN],
  ] as const)('resolve o padrão alimentar %s', (dietaryPattern, packageId) => {
    const result = resolver.resolve(snapshot({ dietaryPattern }));
    expect(result.packageIds).toContain(packageId);
    expect(result.packageIds).toContain(P.FOOD_SUBSTITUTION);
    if (packageId === P.VEGAN) {
      expect(result.packageIds).not.toContain(P.VEGETARIAN);
    }
  });

  it.each([
    ['Intolerância à lactose', P.LACTOSE_INTOLERANCE],
    ['Sem glúten', P.GLUTEN_RESTRICTION],
  ] as const)('resolve a restrição %s', (declaredConstraint, packageId) => {
    expectPackages({ constraints: [declaredConstraint] }, [
      packageId,
      P.FOOD_RESTRICTION_SAFETY,
      P.FOOD_SUBSTITUTION,
    ]);
  });

  it.each([
    ['baixo', P.BUDGET_LOW],
    ['moderado', P.BUDGET_MEDIUM],
    ['alto', P.BUDGET_HIGH],
  ] as const)('resolve o orçamento %s', (budget, packageId) => {
    const result = resolver.resolve(snapshot({ budget }));
    expect(result.packageIds).toContain(packageId);
    expect(
      result.packageIds.filter((id) =>
        [P.BUDGET_LOW, P.BUDGET_MEDIUM, P.BUDGET_HIGH].includes(
          id as typeof P.BUDGET_LOW,
        ),
      ),
    ).toHaveLength(1);
  });

  it('resolve rotina com pouco tempo e refeições fora', () => {
    expectPackages(
      {
        cookingAvailability: 'pouco tempo',
        mealsAwayFromHome: true,
        eatingOutFrequency: 'frequente',
      },
      [P.LIMITED_COOKING_TIME, P.MEALS_AWAY_FROM_HOME],
    );
  });

  it('mantém hidratação e educação estruturadas como fundamentos', () => {
    const result = resolver.resolve(snapshot({ hydration: 'baixa' }));
    expect(result.packageIds).toEqual(
      expect.arrayContaining([
        P.HYDRATION,
        P.HEALTHY_EATING_FOUNDATION,
        P.NUTRITION_EDUCATION_FOUNDATION,
      ]),
    );
    const hydration = result.packages.find((item) => item.id === P.HYDRATION);
    expect(hydration?.educationalMessages).not.toHaveLength(0);
  });

  it('resolve preferências e rejeições sem expor os alimentos no pacote', () => {
    expectPackages({ preferredFoods: ['arroz'], rejectedFoods: ['coentro'] }, [
      P.FOOD_PREFERENCES,
      P.FOOD_REJECTIONS,
      P.FOOD_SUBSTITUTION,
    ]);
  });

  it('aplica somente limites estruturados para contexto clínico e população especial', () => {
    const result = resolver.resolve(
      snapshot({ medicalConditions: ['Diabetes'], ageYears: 17 }),
    );
    expect(result.packageIds).toEqual(
      expect.arrayContaining([
        P.CLINICAL_SAFETY_BOUNDARY,
        P.SPECIAL_POPULATION_BOUNDARY,
      ]),
    );
    expect(result.safetyRestricted).toBe(true);
    const limits = result.packages
      .filter((item) => item.priority === 'CRITICAL')
      .flatMap((item) => item.limits.map((limit) => limit.code));
    expect(limits).toEqual(
      expect.arrayContaining([
        'NO_CLINICAL_PROTOCOL',
        'NO_SPECIAL_POPULATION_PROTOCOL',
      ]),
    );
  });

  it('resolve comportamento quando existe contexto longitudinal de aderência', () => {
    expectPackages({ adherenceScore: 72 }, [P.BEHAVIOR_ADHERENCE]);
  });

  it.each([
    ['recomposição corporal', P.BODY_RECOMPOSITION],
    ['cutting preservando massa', P.MUSCLE_PRESERVING_CUT],
    ['bulking controlado', P.CONTROLLED_BULKING],
  ] as const)(
    'resolve o resultado corporal estruturado %s',
    (desiredOutcome, packageId) => {
      expectPackages({ desiredOutcome }, [packageId]);
    },
  );

  it.each([
    ['musculação', P.STRENGTH_NUTRITION],
    ['treinamento funcional', P.FUNCTIONAL_TRAINING_NUTRITION],
    ['HIIT', P.HIIT_NUTRITION],
    ['endurance', P.ENDURANCE_NUTRITION],
    ['treino híbrido', P.HYBRID_TRAINING_NUTRITION],
  ] as const)('resolve a expansão esportiva %s', (modality, packageId) => {
    expectPackages({ modality }, [
      packageId,
      P.SPORTS_NUTRITION_FOUNDATION,
      P.TRAINING_DAY_CARBOHYDRATE_SUPPORT,
    ]);
  });

  it.each([
    ['iniciante', P.BEGINNER_NUTRITION_GUIDANCE],
    ['intermediário', P.INTERMEDIATE_NUTRITION_GUIDANCE],
    ['avançado', P.ADVANCED_NUTRITION_GUIDANCE],
  ] as const)(
    'modula conhecimento pela experiência %s',
    (experienceLevel, packageId) => {
      const result = resolver.resolve(snapshot({ experienceLevel }));
      expect(result.packageIds).toContain(packageId);
      expect(
        result.packageIds.filter((id) =>
          [
            P.BEGINNER_NUTRITION_GUIDANCE,
            P.INTERMEDIATE_NUTRITION_GUIDANCE,
            P.ADVANCED_NUTRITION_GUIDANCE,
          ].includes(id as typeof P.BEGINNER_NUTRITION_GUIDANCE),
        ),
      ).toHaveLength(1);
    },
  );

  it('ativa timing pré e pós treino a partir dos horários estruturados', () => {
    expectPackages({}, [
      P.PRE_WORKOUT_NUTRITION,
      P.POST_WORKOUT_RECOVERY,
      P.PROTEIN_DISTRIBUTION_EDUCATION,
    ]);
  });

  it('só ativa intra-treino e cautela com eletrólitos quando duração e modalidade sustentam', () => {
    const longSession = resolver.resolve(
      snapshot({ modality: 'endurance', sessionDurationMinutes: 90 }),
    );
    const shortSession = resolver.resolve(
      snapshot({ modality: 'endurance', sessionDurationMinutes: 45 }),
    );

    expect(longSession.packageIds).toEqual(
      expect.arrayContaining([
        P.INTRA_WORKOUT_NUTRITION,
        P.ELECTROLYTE_CAUTION,
      ]),
    );
    expect(shortSession.packageIds).not.toContain(P.INTRA_WORKOUT_NUTRITION);
    expect(shortSession.packageIds).not.toContain(P.ELECTROLYTE_CAUTION);
  });

  it('resolve hidratação insuficiente, baixa aderência e alta aderência sem sobreposição', () => {
    expectPackages({ hydration: 'insuficiente' }, [P.HYDRATION_INSUFFICIENCY]);
    expectPackages({ adherenceScore: 42 }, [P.LOW_ADHERENCE_SUPPORT]);
    const high = resolver.resolve(snapshot({ adherenceScore: 91 }));
    expect(high.packageIds).toContain(P.HIGH_ADHERENCE_AUTONOMY);
    expect(high.packageIds).not.toContain(P.LOW_ADHERENCE_SUPPORT);
  });

  it('resolve múltiplas restrições e preserva todas como safety', () => {
    const result = resolver.resolve(
      snapshot({ constraints: ['lactose', 'glúten', 'soja'] }),
    );
    expect(result.packageIds).toEqual(
      expect.arrayContaining([
        P.MULTIPLE_FOOD_CONSTRAINTS,
        P.FOOD_RESTRICTION_SAFETY,
        P.FOOD_SUBSTITUTION,
      ]),
    );
    expect(result.safetyRestricted).toBe(false);
  });

  it.each([
    [['Diabetes tipo 2'], P.DIABETES_SAFETY],
    [['Hipertensão'], P.HYPERTENSION_SAFETY],
    [['Doença renal crônica'], P.RENAL_CONDITION_SAFETY],
    [['Doença hepática'], P.HEPATIC_CONDITION_SAFETY],
    [['Obesidade grave'], P.SEVERE_OBESITY_SAFETY],
    [['Gestação'], P.PREGNANCY_SAFETY],
  ] as const)(
    'aplica boundary específico para %s',
    (medicalConditions, packageId) => {
      const result = resolver.resolve(snapshot({ medicalConditions }));
      expect(result.packageIds).toContain(packageId);
      expect(result.packageIds).toContain(P.CLINICAL_SAFETY_BOUNDARY);
      expect(result.safetyRestricted).toBe(true);
    },
  );

  it.each([
    [16, P.ADOLESCENT_SAFETY],
    [70, P.OLDER_ADULT_SAFETY],
  ] as const)(
    'aplica boundary de fase de vida para idade %s',
    (ageYears, packageId) => {
      const result = resolver.resolve(snapshot({ ageYears }));
      expect(result.packageIds).toEqual(
        expect.arrayContaining([packageId, P.SPECIAL_POPULATION_BOUNDARY]),
      );
      expect(result.safetyRestricted).toBe(true);
    },
  );

  it('não inventa contextos ausentes do Snapshot', () => {
    const result = resolver.resolve(snapshot());
    expect(result.packageIds).not.toEqual(
      expect.arrayContaining([
        P.PREGNANCY_SAFETY,
        P.DIABETES_SAFETY,
        P.HYPERTENSION_SAFETY,
        P.RENAL_CONDITION_SAFETY,
        P.HEPATIC_CONDITION_SAFETY,
        P.SEVERE_OBESITY_SAFETY,
      ]),
    );
  });

  it('resolve conflito corporal de forma determinística sem selecionar packages incompatíveis', () => {
    const result = resolver.resolve(
      snapshot({ desiredOutcome: 'recomposição corporal e cutting' }),
    );
    expect(
      result.packageIds.filter((id) =>
        [
          P.BODY_RECOMPOSITION,
          P.MUSCLE_PRESERVING_CUT,
          P.CONTROLLED_BULKING,
        ].includes(id as typeof P.BODY_RECOMPOSITION),
      ),
    ).toHaveLength(1);
  });

  it('mantém resolução determinística abaixo de 5 ms por Snapshot', () => {
    const input = snapshot({
      desiredOutcome: 'recomposição corporal',
      modality: 'treino híbrido',
      experienceLevel: 'avançado',
      sessionDurationMinutes: 90,
      constraints: ['lactose', 'glúten'],
      adherenceScore: 48,
    });
    const iterations = 1_000;
    const startedAt = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      resolver.resolve(input);
    }
    const averageMilliseconds = (performance.now() - startedAt) / iterations;
    expect(averageMilliseconds).toBeLessThan(5);
  });

  it('é determinístico, não modifica o Snapshot e congela profundamente o resultado', () => {
    const input = snapshot({
      goal: FitnessGoal.WEIGHT_LOSS,
      modality: 'corrida',
      constraints: ['lactose'],
      preferredFoods: ['banana'],
    });
    const before = JSON.stringify(input);
    const first = resolver.resolve(input);
    const second = resolver.resolve(input);

    expect(first).toEqual(second);
    expect(JSON.stringify(input)).toBe(before);
    expect(first.schemaVersion).toBe(NUTRITION_KNOWLEDGE_SCHEMA_VERSION);
    expect(first.catalogVersion).toBe(NUTRITION_KNOWLEDGE_CATALOG_VERSION);
    expectDeeplyFrozen(first);
  });

  it('mantém catálogo versionado, independente e referencialmente íntegro', () => {
    const ids = new Set(NUTRITION_KNOWLEDGE_PACKAGES.map((item) => item.id));
    expect(ids.size).toBe(NUTRITION_KNOWLEDGE_PACKAGES.length);
    for (const knowledgePackage of NUTRITION_KNOWLEDGE_PACKAGES) {
      expect(knowledgePackage.schemaVersion).toBe(1);
      expect(knowledgePackage.catalogVersion).toBe(
        NUTRITION_KNOWLEDGE_CATALOG_VERSION,
      );
      expect(knowledgePackage.objective).toBeTruthy();
      expect(knowledgePackage.whenToApply.conditions).not.toHaveLength(0);
      expect(Array.isArray(knowledgePackage.whenNotToApply.conditions)).toBe(
        true,
      );
      expect(Array.isArray(knowledgePackage.positiveFactors)).toBe(true);
      expect(Array.isArray(knowledgePackage.negativeFactors)).toBe(true);
      expect(knowledgePackage.educationalMessages).not.toHaveLength(0);
      expect(knowledgePackage.limits).not.toHaveLength(0);
      for (const reference of [
        ...knowledgePackage.dependencyPackageIds,
        ...knowledgePackage.conflictingPackageIds,
      ]) {
        expect(ids.has(reference)).toBe(true);
      }
      expect(knowledgePackage.dependencyPackageIds).not.toContain(
        knowledgePackage.id,
      );
      for (const conflictId of knowledgePackage.conflictingPackageIds) {
        expect(
          NUTRITION_KNOWLEDGE_PACKAGES.find((item) => item.id === conflictId)
            ?.conflictingPackageIds,
        ).toContain(knowledgePackage.id);
      }
      expectDeeplyFrozen(knowledgePackage);
    }
    expectDependencyGraphToBeAcyclic();
  });
});

function expectDependencyGraphToBeAcyclic(): void {
  const packageById = new Map(
    NUTRITION_KNOWLEDGE_PACKAGES.map((knowledgePackage) => [
      knowledgePackage.id,
      knowledgePackage,
    ]),
  );
  const visited = new Set<NutritionKnowledgePackageId>();
  const visiting = new Set<NutritionKnowledgePackageId>();

  function visit(packageId: NutritionKnowledgePackageId): void {
    expect(visiting.has(packageId)).toBe(false);
    if (visited.has(packageId)) return;
    visiting.add(packageId);
    for (const dependencyId of packageById.get(packageId)
      ?.dependencyPackageIds ?? []) {
      visit(dependencyId);
    }
    visiting.delete(packageId);
    visited.add(packageId);
  }

  for (const packageId of packageById.keys()) visit(packageId);
}

function expectDeeplyFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeeplyFrozen(nested);
}
