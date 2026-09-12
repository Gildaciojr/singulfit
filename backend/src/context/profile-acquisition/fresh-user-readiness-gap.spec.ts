import { CoachProfileFieldValue, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentNutritionPlanReaderService } from '../../diet/current-nutrition-plan-reader.service';
import { NutritionPlanningReadinessService } from '../../diet/v2/nutrition-planning-readiness.service';
import { WorkoutPlanningReadinessService } from '../../workout/v2/workout-planning-readiness.service';
import { CoachProfileSnapshotBuilder } from '../coach-profile-snapshot.builder';
import { CoachAdaptiveProfileCollectorService } from '../coach-adaptive-profile-collector.service';
import { ConversationGoalPlannerService } from '../conversation-goal-planner.service';
import { CoachProfileFieldRegistryService } from './coach-profile-field-registry.service';
import { CoachProfileAcquisitionProjectionService } from './coach-profile-acquisition-projection.service';
import { ProfileQuestionSpecificationService } from './profile-question.service';
import { ProfileAcquisitionRuntimeService } from './profile-acquisition-runtime.service';

describe('Fresh user readiness architectural gap', () => {
  const registry = new CoachProfileFieldRegistryService();
  const at = new Date('2026-09-07T12:00:00Z');

  function subject() {
    const values = registry
      .all()
      .filter((d) => d.field !== 'MEDICAL_CONDITIONS')
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
    };
    const builder = new CoachProfileSnapshotBuilder(
      prisma as unknown as PrismaService,
      new CoachProfileAcquisitionProjectionService(),
      {
        getCurrent: jest.fn().mockResolvedValue(null),
      } as unknown as CurrentNutritionPlanReaderService,
    );
    const runtime = new ProfileAcquisitionRuntimeService(
      prisma as unknown as PrismaService,
      builder,
      new CoachAdaptiveProfileCollectorService(),
      new ConversationGoalPlannerService(),
      new ProfileQuestionSpecificationService(registry),
    );
    return { builder, runtime };
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

  it('proves running distance requires data with no acquisition registry field', async () => {
    const snapshot = await subject().builder.build('fresh-user-a', at);
    const readiness = new WorkoutPlanningReadinessService().evaluate(
      snapshot,
      'WEEKLY_PLAN',
      'RUNNING',
      {
        objective: {
          status: 'EXPLICIT',
          value: 'COMPLETE_DISTANCE',
          source: 'CURRENT_MESSAGE',
        },
      },
      false,
    );
    expect(readiness.missingFields).toEqual(
      expect.arrayContaining(['TARGET_DISTANCE', 'CURRENT_RUNNING_DISTANCE']),
    );
    expect(registry.all().map((d) => d.field)).not.toEqual(
      expect.arrayContaining(['TARGET_DISTANCE', 'CURRENT_RUNNING_DISTANCE']),
    );
  });
});
