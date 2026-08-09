import { Test } from '@nestjs/testing';
import {
  ActivityLevel,
  CoachProfileAcquisitionField,
  CoachProfileConfirmationState,
  CoachProfileFieldValue,
  CoachProfileValueSource,
  CoachProfileValueStatus,
  CoachProfileValueType,
  BehavioralAdherenceStyle,
  BehavioralCommunicationStyle,
  BehavioralMotivationStyle,
  BehavioralPersonalityPattern,
  CoachAdaptationMode,
  CoachCoachingStyle,
  CoachCommunicationStyle,
  CoachMotivationStyle,
  CoachTone,
  DietPlanStatus,
  FitnessGoal,
  FoodPreferenceKind,
  Gender,
  GoalProgressionState,
  LongitudinalDirection,
  Prisma,
  StageOfChange,
  UserGoalType,
  WorkoutStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CoachProfileSnapshotBuilder } from './coach-profile-snapshot.builder';
import {
  COACH_PROFILE_COMPLETION_SECTION,
  COACH_PROFILE_COMPLETION_STATE,
  COACH_PROFILE_DATA_SOURCE,
  COACH_PROFILE_KNOWLEDGE_STATUS,
} from './coach-profile-snapshot.contract';
import { ContextModule } from './context.module';
import { CoachProfileAcquisitionProjectionService } from './profile-acquisition/coach-profile-acquisition-projection.service';
import { CurrentNutritionPlanReaderService } from '../diet/current-nutrition-plan-reader.service';

describe('CoachProfileSnapshotBuilder', () => {
  const referenceDate = new Date('2026-07-15T12:00:00.000Z');

  function userRecord() {
    return {
      id: 'user-id',
      name: '  Ana  ',
      onboardingCompleted: true,
      fitnessProfile: {
        gender: Gender.FEMALE,
        birthDate: new Date('1991-08-20T00:00:00.000Z'),
        heightCm: 165,
        currentWeightKg: new Prisma.Decimal('68.50'),
        targetWeightKg: new Prisma.Decimal('62.00'),
        activityLevel: ActivityLevel.MODERATE,
        goal: FitnessGoal.WEIGHT_LOSS,
        foodRestrictions: [{ type: 'INTOLERANCE', description: 'Sem lactose' }],
        injuryRestrictions: [{ description: 'Desconforto no joelho' }],
      },
      nutritionProfile: {
        sex: Gender.FEMALE,
        birthDate: new Date('1991-08-20T00:00:00.000Z'),
        heightCm: 165,
        currentWeightKg: new Prisma.Decimal('68.50'),
        targetWeightKg: new Prisma.Decimal('62.00'),
        activityLevel: ActivityLevel.MODERATE,
        goal: FitnessGoal.WEIGHT_LOSS,
        restrictions: [{ type: 'INTOLERANCE', description: 'Sem lactose' }],
        allergies: [{ type: 'ALLERGY', description: 'Amendoim' }],
        medicalConditions: [{ description: 'Acompanhamento profissional' }],
      },
      preferences: {
        preferredWakeUpTime: '07:00',
        preferredSleepTime: '23:00',
        preferredTrainingTime: '18:30',
        preferredMealTimes: ['08:00', '12:30', '19:30'],
        preferredLanguage: 'pt-BR',
        timezone: 'America/Sao_Paulo',
      },
      coachProfile: {
        communicationStyle: CoachCommunicationStyle.FRIENDLY,
        coachingStyle: CoachCoachingStyle.EDUCATOR,
        tone: CoachTone.MODERATE,
        motivationStyle: CoachMotivationStyle.HEALTH,
      },
      goalClassification: {
        goal: UserGoalType.WEIGHT_LOSS,
        confidence: new Prisma.Decimal('0.9200'),
      },
      behavioralProfile: {
        communicationStyle: BehavioralCommunicationStyle.DIRECT,
        motivationStyle: BehavioralMotivationStyle.HEALTH,
        adherenceStyle: BehavioralAdherenceStyle.STRUCTURED,
        personalityPattern: BehavioralPersonalityPattern.ROUTINE_ORIENTED,
        preferredEngagementHour: 18,
      },
      behavioralSnapshots: [{ stage: StageOfChange.ACTION }],
      fitnessCheckIns: [{ adherenceScore: 82 }],
      progressSnapshots: [{ weightKg: new Prisma.Decimal('67.90') }],
      longitudinalProfiles: [{ adherenceScore: 78 }],
      foodPreferenceSnapshots: [
        {
          foodName: 'Arroz',
          kind: FoodPreferenceKind.FREQUENT,
          confidence: new Prisma.Decimal('0.9100'),
          occurrences: 8,
        },
      ],
      nutritionEvolution: [
        {
          overallDirection: LongitudinalDirection.IMPROVING,
          mealsAnalyzed: 14,
          qualityScore: 76,
        },
      ],
      goalProgression: [
        {
          goal: UserGoalType.WEIGHT_LOSS,
          state: GoalProgressionState.IMPROVING,
          score: 74,
        },
      ],
      coachAdaptations: [
        {
          mode: CoachAdaptationMode.PERFORMANCE,
          reason: 'Adesão estável',
        },
      ],
      dietPlans: [
        {
          id: 'diet-id',
          title: 'Plano atual',
          objective: FitnessGoal.WEIGHT_LOSS,
          status: DietPlanStatus.ACTIVE,
          generatedAt: new Date('2026-07-10T10:00:00.000Z'),
        },
      ],
      workoutPlans: [
        {
          id: 'workout-id',
          title: 'Treino atual',
          objective: FitnessGoal.WEIGHT_LOSS,
          status: WorkoutStatus.ACTIVE,
          generatedAt: new Date('2026-07-11T10:00:00.000Z'),
        },
      ],
      conversationMemories: [
        { summary: 'Prefere orientações práticas e curtas.' },
      ],
      coachProfileFieldValues: new Array<CoachProfileFieldValue>(),
    };
  }

  async function subject(
    user: ReturnType<typeof userRecord> | null = userRecord(),
    activationContent: Prisma.JsonValue = {
      desiredResultText: 'Quero ter mais disposição e perder peso',
      restrictions: ['Sem lactose'],
      targetWeightSource: 'EXTRACTED_FROM_USER_TEXT',
    },
  ) {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
      },
      conversationMemory: {
        findUnique: jest.fn().mockResolvedValue({ content: activationContent }),
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        CoachProfileSnapshotBuilder,
        CoachProfileAcquisitionProjectionService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CurrentNutritionPlanReaderService,
          useValue: { getCurrent: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    return {
      builder: module.get(CoachProfileSnapshotBuilder),
      prisma,
    };
  }

  it('consolidates known, inferred and current-plan data without changing its provenance', async () => {
    const test = await subject();
    const snapshot = await test.builder.build('user-id', referenceDate);

    expect(snapshot.identity.displayName).toEqual({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
      value: 'Ana',
      sources: [COACH_PROFILE_DATA_SOURCE.USER],
    });
    expect(snapshot.physical.ageYears).toEqual({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.INFERRED,
      value: 34,
      sources: [
        COACH_PROFILE_DATA_SOURCE.FITNESS_PROFILE,
        COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE,
      ],
    });
    expect(snapshot.physical.currentWeightKg).toMatchObject({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
      value: 68.5,
    });
    expect(snapshot.nutrition.desiredOutcome).toMatchObject({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
      value: 'Quero ter mais disposição e perder peso',
    });
    expect(snapshot.nutrition.desiredMealCount).toMatchObject({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.INFERRED,
      value: 3,
    });
    expect(snapshot.preferences.foodPreferences).toMatchObject({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.INFERRED,
      value: [{ foodName: 'Arroz', confidence: 0.91, occurrences: 8 }],
    });
    expect(snapshot.longitudinal.adherenceScore).toMatchObject({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
      value: 82,
      sources: [COACH_PROFILE_DATA_SOURCE.FITNESS_CHECK_IN],
    });
    expect(snapshot.plans.currentDiet).toMatchObject({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
      value: { id: 'diet-id', generatedAt: '2026-07-10T10:00:00.000Z' },
    });
    expect(snapshot.conflicts).toEqual([]);
    expect(
      snapshot.completion.sections
        .filter((section) => section.ready)
        .map((section) => section.section),
    ).toEqual([
      COACH_PROFILE_COMPLETION_SECTION.GENERAL,
      COACH_PROFILE_COMPLETION_SECTION.NUTRITION,
      COACH_PROFILE_COMPLETION_SECTION.ROUTINE,
      COACH_PROFILE_COMPLETION_SECTION.SAFETY,
    ]);
    expect(snapshot.completion.overall).toBe(
      COACH_PROFILE_COMPLETION_STATE.PARTIAL,
    );
  });

  it('keeps unavailable training fields explicitly unknown instead of inventing them', async () => {
    const test = await subject();
    const snapshot = await test.builder.build('user-id', referenceDate);
    const training = snapshot.completion.sections.find(
      (section) =>
        section.section === COACH_PROFILE_COMPLETION_SECTION.TRAINING,
    );

    expect(snapshot.training.experienceLevel.status).toBe(
      COACH_PROFILE_KNOWLEDGE_STATUS.UNKNOWN,
    );
    expect(snapshot.training.preferredModality.status).toBe(
      COACH_PROFILE_KNOWLEDGE_STATUS.UNKNOWN,
    );
    expect(snapshot.training.availableEquipment.status).toBe(
      COACH_PROFILE_KNOWLEDGE_STATUS.UNKNOWN,
    );
    expect(training).toMatchObject({
      state: COACH_PROFILE_COMPLETION_STATE.PARTIAL,
      ready: false,
    });
    expect(training?.missingFields).toEqual(
      expect.arrayContaining([
        'TRAINING_EXPERIENCE',
        'TRAINING_MODALITY',
        'TRAINING_EQUIPMENT',
      ]),
    );
  });

  it('projects confirmed, inferred and conflicted structured acquisition values with provenance', async () => {
    const record = userRecord();
    const test = await subject({
      ...record,
      coachProfileFieldValues: [
        acquired({
          field: CoachProfileAcquisitionField.TRAINING_MODALITY,
          valueType: CoachProfileValueType.TEXT,
          textValue: 'GYM_STRENGTH',
        }),
        acquired({
          field: CoachProfileAcquisitionField.WEEKLY_FREQUENCY,
          valueType: CoachProfileValueType.INTEGER,
          integerValue: 3,
          status: CoachProfileValueStatus.INFERRED,
        }),
        acquired({
          field: CoachProfileAcquisitionField.FOOD_INTOLERANCES,
          valueType: CoachProfileValueType.TEXT_LIST,
          textListValue: ['LACTOSE'],
          status: CoachProfileValueStatus.CONFLICTED,
          isActive: false,
          confirmationState: CoachProfileConfirmationState.PENDING,
        }),
      ],
    });
    const snapshot = await test.builder.build('user-id', referenceDate);

    expect(snapshot.training.preferredModality).toEqual({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
      value: 'GYM_STRENGTH',
      sources: [COACH_PROFILE_DATA_SOURCE.PROFILE_ACQUISITION],
    });
    expect(snapshot.training.weeklyFrequency).toMatchObject({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.INFERRED,
      value: 3,
    });
    expect(snapshot.nutrition.foodIntolerances).toMatchObject({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.REQUIRES_CONFIRMATION,
      value: [{ type: 'INTOLERANCE', description: 'LACTOSE' }],
    });
    expect(Object.isFrozen(snapshot.training.preferredModality)).toBe(true);
    expect(Object.isFrozen(snapshot.nutrition.foodIntolerances)).toBe(true);
  });

  it('keeps an onboarding-estimated target weight explicitly inferred', async () => {
    const test = await subject(userRecord(), {
      desiredResultText: 'Quero emagrecer',
      restrictions: [],
      targetWeightSource: 'ESTIMATED_FROM_GOAL',
    });
    const snapshot = await test.builder.build('user-id', referenceDate);

    expect(snapshot.physical.targetWeightKg).toMatchObject({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.INFERRED,
      value: 62,
      sources: [
        COACH_PROFILE_DATA_SOURCE.FITNESS_PROFILE,
        COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE,
        COACH_PROFILE_DATA_SOURCE.ACTIVATION_ONBOARDING,
      ],
    });
    expect(snapshot.conversation.preferredLanguage.status).toBe(
      COACH_PROFILE_KNOWLEDGE_STATUS.INFERRED,
    );
    expect(snapshot.conversation.timezone.status).toBe(
      COACH_PROFILE_KNOWLEDGE_STATUS.INFERRED,
    );
  });

  it('represents a missing profile deterministically as insufficient and unknown', async () => {
    const record = userRecord();
    const test = await subject(
      {
        ...record,
        name: null,
        onboardingCompleted: false,
        fitnessProfile: null,
        nutritionProfile: null,
        preferences: null,
        coachProfile: null,
        goalClassification: null,
        behavioralProfile: null,
        behavioralSnapshots: [],
        fitnessCheckIns: [],
        progressSnapshots: [],
        longitudinalProfiles: [],
        foodPreferenceSnapshots: [],
        nutritionEvolution: [],
        goalProgression: [],
        coachAdaptations: [],
        dietPlans: [],
        workoutPlans: [],
        conversationMemories: [],
      },
      null,
    );
    const snapshot = await test.builder.build('user-id', referenceDate);

    expect(snapshot.physical.sex.status).toBe(
      COACH_PROFILE_KNOWLEDGE_STATUS.UNKNOWN,
    );
    expect(snapshot.restrictions.allergies.status).toBe(
      COACH_PROFILE_KNOWLEDGE_STATUS.UNKNOWN,
    );
    expect(snapshot.completion.overall).toBe(
      COACH_PROFILE_COMPLETION_STATE.INSUFFICIENT,
    );
  });

  it('exposes conflicting FitnessProfile and NutritionProfile data for confirmation', async () => {
    const record = userRecord();
    const test = await subject({
      ...record,
      nutritionProfile: {
        ...record.nutritionProfile,
        currentWeightKg: new Prisma.Decimal('70.00'),
        goal: FitnessGoal.MAINTENANCE,
      },
    });
    const snapshot = await test.builder.build('user-id', referenceDate);

    expect(snapshot.physical.currentWeightKg).toMatchObject({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.REQUIRES_CONFIRMATION,
      value: 68.5,
    });
    expect(snapshot.nutrition.primaryGoal).toMatchObject({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.REQUIRES_CONFIRMATION,
      value: FitnessGoal.WEIGHT_LOSS,
    });
    expect(snapshot.conflicts.map((conflict) => conflict.field)).toEqual([
      'CURRENT_WEIGHT',
      'PRIMARY_GOAL',
    ]);
  });

  it('distinguishes confirmed empty restrictions from unconfirmed empty safety data', async () => {
    const record = userRecord();
    const test = await subject(
      {
        ...record,
        fitnessProfile: {
          ...record.fitnessProfile,
          foodRestrictions: [],
          injuryRestrictions: [],
        },
        nutritionProfile: {
          ...record.nutritionProfile,
          restrictions: [],
          allergies: [],
          medicalConditions: [],
        },
      },
      { desiredResultText: null, restrictions: [] },
    );
    const snapshot = await test.builder.build('user-id', referenceDate);

    expect(snapshot.restrictions.foodRestrictions).toMatchObject({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
      value: [],
    });
    expect(snapshot.restrictions.allergies).toMatchObject({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.REQUIRES_CONFIRMATION,
      value: [],
    });
    expect(snapshot.restrictions.physicalLimitations.status).toBe(
      COACH_PROFILE_KNOWLEDGE_STATUS.REQUIRES_CONFIRMATION,
    );
  });

  it.each([
    'Nenhuma restrição',
    ' Sem restrições. ',
    'Não tenho restrições alimentares',
  ])(
    'projects the legacy explicit absence "%s" as known empty food restrictions',
    async (description) => {
      const record = userRecord();
      const test = await subject(
        {
          ...record,
          fitnessProfile: {
            ...record.fitnessProfile,
            foodRestrictions: [],
          },
          nutritionProfile: {
            ...record.nutritionProfile,
            restrictions: [{ type: 'ONBOARDING', description }],
          },
        },
        { desiredResultText: null },
      );

      const snapshot = await test.builder.build('user-id', referenceDate);

      expect(snapshot.restrictions.foodRestrictions).toEqual({
        status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
        value: [],
        sources: [
          COACH_PROFILE_DATA_SOURCE.FITNESS_PROFILE,
          COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE,
        ],
      });
    },
  );

  it.each([
    'Nenhuma restrição',
    ' Sem restrições. ',
    'Não tenho restrições alimentares',
  ])(
    'projects the FitnessProfile explicit absence "%s" as known empty food restrictions',
    async (description) => {
      const record = userRecord();
      const test = await subject(
        {
          ...record,
          fitnessProfile: {
            ...record.fitnessProfile,
            foodRestrictions: [{ type: 'ONBOARDING', description }],
          },
          nutritionProfile: {
            ...record.nutritionProfile,
            restrictions: [],
          },
        },
        { desiredResultText: null },
      );

      const snapshot = await test.builder.build('user-id', referenceDate);

      expect(snapshot.restrictions.foodRestrictions).toEqual({
        status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
        value: [],
        sources: [
          COACH_PROFILE_DATA_SOURCE.FITNESS_PROFILE,
          COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE,
        ],
      });
    },
  );

  it('filters explicit absence from FitnessProfile without removing a real food restriction', async () => {
    const record = userRecord();
    const test = await subject(
      {
        ...record,
        fitnessProfile: {
          ...record.fitnessProfile,
          foodRestrictions: [
            {
              type: 'ONBOARDING',
              description: 'Nenhuma restrição',
            },
            {
              type: 'INTOLERANCE',
              description: 'Sem lactose',
            },
          ],
        },
        nutritionProfile: {
          ...record.nutritionProfile,
          restrictions: [],
        },
      },
      { desiredResultText: null },
    );

    const snapshot = await test.builder.build('user-id', referenceDate);

    expect(snapshot.restrictions.foodRestrictions).toEqual({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
      value: [
        {
          type: 'INTOLERANCE',
          description: 'Sem lactose',
          source: COACH_PROFILE_DATA_SOURCE.FITNESS_PROFILE,
        },
      ],
      sources: [
        COACH_PROFILE_DATA_SOURCE.FITNESS_PROFILE,
        COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE,
      ],
    });
  });

  it.each(['Evito alimentos muito picantes', 'Sem lactose', 'Sem glúten'])(
    'preserves the real food restriction "%s"',
    async (description) => {
      const record = userRecord();
      const test = await subject(
        {
          ...record,
          fitnessProfile: {
            ...record.fitnessProfile,
            foodRestrictions: [],
          },
          nutritionProfile: {
            ...record.nutritionProfile,
            restrictions: [{ type: 'ONBOARDING', description }],
          },
        },
        { desiredResultText: null },
      );

      const snapshot = await test.builder.build('user-id', referenceDate);

      expect(snapshot.restrictions.foodRestrictions).toMatchObject({
        status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
        value: [
          {
            type: 'ONBOARDING',
            description,
            source: COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE,
          },
        ],
      });
    },
  );

  it('projects acquired allergy confirmation without fabricating legacy confirmation or hiding conflicts', async () => {
    const record = userRecord();
    const confirmedEmpty = await subject({
      ...record,
      nutritionProfile: { ...record.nutritionProfile, allergies: [] },
      coachProfileFieldValues: [
        acquired({
          field: CoachProfileAcquisitionField.ALLERGIES,
          valueType: CoachProfileValueType.TEXT_LIST,
          textListValue: [],
        }),
      ],
    });
    const emptySnapshot = await confirmedEmpty.builder.build(
      'user-id',
      referenceDate,
    );
    expect(emptySnapshot.restrictions.allergies).toEqual({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
      value: [],
      sources: [
        COACH_PROFILE_DATA_SOURCE.NUTRITION_PROFILE,
        COACH_PROFILE_DATA_SOURCE.PROFILE_ACQUISITION,
      ],
    });

    const confirmedPositive = await subject({
      ...record,
      nutritionProfile: { ...record.nutritionProfile, allergies: [] },
      coachProfileFieldValues: [
        acquired({
          field: CoachProfileAcquisitionField.ALLERGIES,
          valueType: CoachProfileValueType.TEXT_LIST,
          textListValue: ['Castanha'],
        }),
      ],
    });
    const positiveSnapshot = await confirmedPositive.builder.build(
      'user-id',
      referenceDate,
    );
    expect(positiveSnapshot.restrictions.allergies).toMatchObject({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
      value: [{ type: 'ALLERGY', description: 'Castanha' }],
    });

    const conflicting = await subject({
      ...record,
      coachProfileFieldValues: [
        acquired({
          field: CoachProfileAcquisitionField.ALLERGIES,
          valueType: CoachProfileValueType.TEXT_LIST,
          textListValue: [],
        }),
      ],
    });
    const conflictingSnapshot = await conflicting.builder.build(
      'user-id',
      referenceDate,
    );
    expect(conflictingSnapshot.restrictions.allergies).toMatchObject({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.REQUIRES_CONFIRMATION,
      value: [{ type: 'ALLERGY', description: 'Amendoim' }],
    });
  });

  it('is deterministic, deeply frozen and JSON serializable without Prisma values', async () => {
    const test = await subject();
    const first = await test.builder.build('user-id', referenceDate);
    const second = await test.builder.build('user-id', referenceDate);
    const serialized = JSON.stringify(first);

    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.physical)).toBe(true);
    expect(Object.isFrozen(first.physical.ageYears)).toBe(true);
    expect(Object.isFrozen(first.physical.ageYears.sources)).toBe(true);
    expect(
      'value' in first.preferences.foodPreferences &&
        Object.isFrozen(first.preferences.foodPreferences.value),
    ).toBe(true);
    expect(Object.isFrozen(first.completion.sections)).toBe(true);
    expect(Object.isFrozen(first.completion.sections[0].missingFields)).toBe(
      true,
    );
    expect(Object.isFrozen(first.conflicts)).toBe(true);
    expect(JSON.parse(serialized)).toEqual(first);
    expect(serialized).not.toContain('Decimal');
    expect(first.referenceDate).toBe(referenceDate.toISOString());
  });

  it('throws for a missing user and an invalid reference date', async () => {
    const missing = await subject(null, null);
    await expect(
      missing.builder.build('missing-user', referenceDate),
    ).rejects.toThrow('Usuário do CoachProfileSnapshot não encontrado');

    const existing = await subject();
    await expect(
      existing.builder.build('user-id', new Date('invalid')),
    ).rejects.toThrow('Data de referência do CoachProfileSnapshot inválida');
  });

  it('is registered and exported only as inert ContextModule infrastructure', () => {
    const providers: unknown = Reflect.getMetadata('providers', ContextModule);
    const exports: unknown = Reflect.getMetadata('exports', ContextModule);

    expect(Array.isArray(providers) ? providers : []).toContain(
      CoachProfileSnapshotBuilder,
    );
    expect(Array.isArray(exports) ? exports : []).toContain(
      CoachProfileSnapshotBuilder,
    );
  });
});

function acquired(
  input: Partial<CoachProfileFieldValue> &
    Pick<CoachProfileFieldValue, 'field' | 'valueType'>,
): CoachProfileFieldValue {
  return {
    id: input.id ?? 'acquired-' + input.field,
    userId: 'user-id',
    field: input.field,
    valueType: input.valueType,
    textValue: input.textValue ?? null,
    integerValue: input.integerValue ?? null,
    booleanValue: input.booleanValue ?? null,
    textListValue: input.textListValue ?? null,
    valueFingerprint: input.valueFingerprint ?? 'fingerprint-' + input.field,
    status: input.status ?? CoachProfileValueStatus.CONFIRMED,
    source: input.source ?? CoachProfileValueSource.USER_CONFIRMED,
    confirmationState:
      input.confirmationState ?? CoachProfileConfirmationState.CONFIRMED,
    definitionVersion: 1,
    referenceDate: new Date('2026-07-15T12:00:00.000Z'),
    operationKey: input.operationKey ?? 'operation-' + input.field,
    previousValueId: input.previousValueId ?? null,
    isActive: input.isActive ?? true,
    confirmedAt: input.confirmedAt ?? new Date('2026-07-15T12:00:00.000Z'),
    invalidatedAt: input.invalidatedAt ?? null,
    createdAt: input.createdAt ?? new Date('2026-07-15T12:00:00.000Z'),
    updatedAt: input.updatedAt ?? new Date('2026-07-15T12:00:00.000Z'),
  };
}
