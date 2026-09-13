import {
  CoachProfileAcquisitionField,
  CoachProfileFieldValue,
  CoachProfileValueSource,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentNutritionPlanReaderService } from '../../diet/current-nutrition-plan-reader.service';
import { NutritionPlanningReadinessService } from '../../diet/v2/nutrition-planning-readiness.service';
import { WorkoutPlanningReadinessService } from '../../workout/v2/workout-planning-readiness.service';
import { CoachProfileSnapshotBuilder } from '../coach-profile-snapshot.builder';
import { CoachAdaptiveProfileCollectorService } from '../coach-adaptive-profile-collector.service';
import { ConversationGoalPlannerService } from '../conversation-goal-planner.service';
import { RUNNING_COMPLETE_DISTANCE_REQUIRED_FIELDS } from '../planning-profile-requirements.contract';
import { CoachProfileFieldRegistryService } from './coach-profile-field-registry.service';
import {
  CoachProfileMutationCommandFactoryService,
  CoachProfileMutationService,
} from './coach-profile-mutation.service';
import { CoachProfileAcquisitionProjectionService } from './coach-profile-acquisition-projection.service';
import { ProfileQuestionSpecificationService } from './profile-question.service';
import { ProfileAcquisitionRuntimeService } from './profile-acquisition-runtime.service';
import { ProfileAcquisitionOperationalConfigService } from './profile-acquisition-operational-config.service';
import { ProfileAnswerRecognizerService } from './profile-answer-recognizer.service';

describe('Fresh user readiness architectural gap', () => {
  const registry = new CoachProfileFieldRegistryService();
  const at = new Date('2026-09-07T12:00:00Z');

  function subject() {
    const values = registry
      .all()
      .filter(
        (d) =>
          d.field !== 'MEDICAL_CONDITIONS' &&
          d.field !== 'TARGET_DISTANCE' &&
          d.field !== 'CURRENT_RUNNING_DISTANCE',
      )
      .map(
        (d): CoachProfileFieldValue => ({
          id: d.field,
          userId: 'fresh-user-a',
          field: d.field,
          valueType: d.valueType,
          textValue:
            d.valueType === 'TEXT' ? (d.allowedOptions[0] ?? '18:00') : null,
          integerValue: d.valueType === 'INTEGER' ? (d.minimum ?? 1) : null,
          booleanValue: d.valueType === 'BOOLEAN' ? true : null,
          textListValue:
            d.valueType === 'TEXT_LIST'
              ? d.allowedOptions.length
                ? [d.allowedOptions[0]]
                : []
              : null,
          source: 'USER_CONFIRMED',
          confirmationState: 'CONFIRMED',
          status: 'CONFIRMED',
          referenceDate: at,
          definitionVersion: 1,
          valueFingerprint: 'fingerprint-' + d.field,
          operationKey: 'operation-' + d.field,
          isActive: true,
          previousValueId: null,
          invalidatedAt: null,
          createdAt: at,
          updatedAt: at,
        }),
      );
    let createdValueSequence = 0;
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      coachProfileFieldValue: {
        findUnique: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              values.find(
                (value) => value.operationKey === where.operationKey,
              ) ?? null,
            ),
          ),
        findFirst: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              values.find(
                (value) =>
                  value.userId === where.userId &&
                  value.field === where.field &&
                  value.isActive === where.isActive,
              ) ?? null,
            ),
          ),
        create: jest.fn().mockImplementation(({ data }) => {
          createdValueSequence += 1;
          const created = {
            ...data,
            id: `running-distance-${createdValueSequence}`,
            textListValue:
              data.textListValue === Prisma.DbNull ? null : data.textListValue,
            previousValueId: data.previousValueId ?? null,
            invalidatedAt: data.invalidatedAt ?? null,
            createdAt: at,
            updatedAt: at,
          } as CoachProfileFieldValue;
          values.push(created);
          return Promise.resolve({
            id: created.id,
            valueFingerprint: created.valueFingerprint,
          });
        }),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const index = values.findIndex((value) => value.id === where.id);
          if (index < 0) throw new Error('Active profile value not found');
          values[index] = {
            ...values[index],
            ...data,
            updatedAt: at,
          };
          return Promise.resolve(values[index]);
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      userPreferences: { upsert: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'fresh-user-a',
          name: 'Pessoa fictícia',
          onboardingCompleted: true,
          fitnessProfile: null,
          nutritionProfile: {
            sex: 'FEMALE',
            birthDate: new Date('1990-01-01'),
            heightCm: 165,
            currentWeightKg: new Prisma.Decimal(65),
            targetWeightKg: new Prisma.Decimal(60),
            activityLevel: 'MODERATE',
            goal: 'WEIGHT_LOSS',
            restrictions: [],
            allergies: [],
            medicalConditions: [],
          },
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
          coachProfileFieldValues: values,
        }),
      },
      conversationMemory: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ content: { restrictions: [] } }),
      },
      coachProfileAcquisitionCycle: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      message: { count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn(
        async (callback: (client: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const builder = new CoachProfileSnapshotBuilder(
      prisma as unknown as PrismaService,
      new CoachProfileAcquisitionProjectionService(),
      {
        getCurrent: jest.fn().mockResolvedValue(null),
      } as unknown as CurrentNutritionPlanReaderService,
    );
    const questions = new ProfileQuestionSpecificationService(registry);
    const runtime = new ProfileAcquisitionRuntimeService(
      prisma as unknown as PrismaService,
      builder,
      new CoachAdaptiveProfileCollectorService(),
      new ConversationGoalPlannerService(),
      questions,
    );
    const recognizer = new ProfileAnswerRecognizerService(registry);
    const factory = new CoachProfileMutationCommandFactoryService(registry);
    const mutations = new CoachProfileMutationService(
      prisma as unknown as PrismaService,
      registry,
      {
        get: jest.fn().mockReturnValue({
          mode: 'INTERNAL',
          questionExpirationHours: 48,
        }),
      } as unknown as ProfileAcquisitionOperationalConfigService,
    );
    return {
      values,
      transaction,
      builder,
      runtime,
      recognizer,
      factory,
      mutations,
    };
  }

  it('selects MEDICAL_CONDITIONS when it is the sole Nutrition requirement unresolved', async () => {
    const test = subject();
    const snapshot = await test.builder.build('fresh-user-a', at);
    expect(
      new NutritionPlanningReadinessService().evaluate(
        snapshot,
        'DAILY_STRUCTURE',
        false,
      ),
    ).toMatchObject({
      status: 'REQUIRES_CONFIRMATION',
      confirmationRequiredFields: ['MEDICAL_CONDITIONS'],
    });
    expect(
      await test.runtime.evaluate('fresh-user-a', at, 'DIET_PLAN_REQUEST'),
    ).toMatchObject({
      evaluation: {
        canAsk: true,
        reason: 'READY',
        selectedField: 'MEDICAL_CONDITIONS',
      },
      specification: { field: 'MEDICAL_CONDITIONS' },
    });
  });

  it('acquires each running-distance requirement once and clears the readiness blockers', async () => {
    const test = subject();
    const conversationContext = Object.freeze({
      modality: Object.freeze({
        value: 'RUNNING' as const,
        evidence: 'EXPLICIT' as const,
      }),
      requiresRunningDistanceProfile: true,
      requiresWorkoutCalendar: false,
    });
    const acquiredFields: CoachProfileAcquisitionField[] = [];

    for (let step = 0; step < 2; step += 1) {
      const state = await test.runtime.evaluate(
        'fresh-user-a',
        at,
        'WORKOUT_PLAN_REQUEST',
        conversationContext,
      );
      expect(state.evaluation.canAsk).toBe(true);
      expect(state.evaluation.reason).toBe('READY');
      expect(RUNNING_COMPLETE_DISTANCE_REQUIRED_FIELDS).toContain(
        state.evaluation.selectedField,
      );
      expect(acquiredFields).not.toContain(state.evaluation.selectedField);
      if (!state.specification) {
        throw new Error('Running-distance question specification expected');
      }

      const field = state.specification.field;
      const rawAnswer =
        field === CoachProfileAcquisitionField.TARGET_DISTANCE
          ? '5 km'
          : field === CoachProfileAcquisitionField.CURRENT_RUNNING_DISTANCE
            ? 'hoje consigo correr 2,5 km'
            : null;
      if (!rawAnswer) {
        throw new Error(`Unexpected acquisition field: ${field}`);
      }

      const answer = test.recognizer.recognize(state.specification, rawAnswer);
      expect(answer).toMatchObject({ disposition: 'RECOGNIZED' });
      const command = test.factory.create({
        userId: 'fresh-user-a',
        answer,
        source: CoachProfileValueSource.USER_REPORTED,
        referenceDate: at.toISOString(),
        sourceOperationKey: `running-distance-step-${step + 1}`,
        reason: 'INITIAL_ANSWER',
      });
      if (!command) throw new Error('Running-distance mutation expected');

      await expect(test.mutations.execute(command)).resolves.toMatchObject({
        status: 'CREATED',
        field,
      });
      acquiredFields.push(field);
    }

    expect(new Set(acquiredFields)).toEqual(
      new Set([
        CoachProfileAcquisitionField.TARGET_DISTANCE,
        CoachProfileAcquisitionField.CURRENT_RUNNING_DISTANCE,
      ]),
    );
    expect(
      test.transaction.coachProfileFieldValue.create,
    ).toHaveBeenCalledTimes(2);

    const afterAcquisition = await test.runtime.evaluate(
      'fresh-user-a',
      at,
      'WORKOUT_PLAN_REQUEST',
      conversationContext,
    );
    expect(afterAcquisition.evaluation.selectedField).not.toBe(
      CoachProfileAcquisitionField.TARGET_DISTANCE,
    );
    expect(afterAcquisition.evaluation.selectedField).not.toBe(
      CoachProfileAcquisitionField.CURRENT_RUNNING_DISTANCE,
    );

    const snapshot = await test.builder.build('fresh-user-a', at);
    expect(snapshot.training.targetDistanceKm).toMatchObject({
      status: 'KNOWN',
      value: 5,
    });
    expect(snapshot.training.currentRunningDistanceKm).toMatchObject({
      status: 'KNOWN',
      value: 2.5,
    });

    const readiness = new WorkoutPlanningReadinessService().evaluate(
      snapshot,
      'WEEKLY_PLAN',
      'RUNNING',
      {
        objective: {
          status: 'CONFIRMED',
          value: 'COMPLETE_DISTANCE',
          source: 'CURRENT_MESSAGE',
        },
      },
      false,
    );
    expect(readiness.missingFields).not.toContain('TARGET_DISTANCE');
    expect(readiness.missingFields).not.toContain('CURRENT_RUNNING_DISTANCE');
  });

  it('requires and acquires running distances for a complete-distance objective', async () => {
    const snapshot = await subject().builder.build('fresh-user-a', at);
    expect(snapshot.training.targetDistanceKm?.status).toBe('UNKNOWN');
    expect(snapshot.training.currentRunningDistanceKm?.status).toBe('UNKNOWN');
    const readiness = new WorkoutPlanningReadinessService().evaluate(
      snapshot,
      'WEEKLY_PLAN',
      'RUNNING',
      {
        objective: {
          status: 'CONFIRMED',
          value: 'COMPLETE_DISTANCE',
          source: 'CURRENT_MESSAGE',
        },
      },
      false,
    );
    expect(readiness.requiredFields).toEqual(
      expect.arrayContaining(['TARGET_DISTANCE', 'CURRENT_RUNNING_DISTANCE']),
    );
    expect(readiness.missingFields).toEqual(
      expect.arrayContaining(['TARGET_DISTANCE', 'CURRENT_RUNNING_DISTANCE']),
    );
    expect(registry.all().map((d) => d.field)).toEqual(
      expect.arrayContaining(['TARGET_DISTANCE', 'CURRENT_RUNNING_DISTANCE']),
    );
  });
});
