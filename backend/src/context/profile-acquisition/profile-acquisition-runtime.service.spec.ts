import {
  CoachProfileAcquisitionCycleStatus,
  CoachProfileAcquisitionField,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CoachAdaptiveProfileCollectorService } from '../coach-adaptive-profile-collector.service';
import { PROFILE_ACQUISITION_INTENT } from '../coach-adaptive-profile-collector.contract';
import { CoachProfileSnapshotBuilder } from '../coach-profile-snapshot.builder';
import type { CoachProfileSnapshot } from '../coach-profile-snapshot.contract';
import {
  CONVERSATION_GOAL,
  CONVERSATION_RECOGNIZED_INTENT,
} from '../conversation-goal-planner.contract';
import { ConversationGoalPlannerService } from '../conversation-goal-planner.service';
import { ProfileAcquisitionRuntimeService } from './profile-acquisition-runtime.service';
import { ProfileQuestionSpecificationService } from './profile-question.service';

describe('ProfileAcquisitionRuntimeService', () => {
  it('feeds persisted history and the rebuilt Snapshot through Collector and Planner', async () => {
    const snapshot = {
      completion: {
        overall: 'PARTIAL',
        sections: Object.freeze([]),
      },
    } as unknown as CoachProfileSnapshot;
    const prisma = {
      coachProfileAcquisitionCycle: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'asked-cycle',
            field: CoachProfileAcquisitionField.DESIRED_MEAL_COUNT,
            status: CoachProfileAcquisitionCycleStatus.ASKED,
            logicalTurn: 2,
            askedAt: new Date('2026-07-16T11:00:00.000Z'),
          },
          {
            id: 'declined-cycle',
            field: CoachProfileAcquisitionField.FOOD_INTOLERANCES,
            status: CoachProfileAcquisitionCycleStatus.DECLINED,
            logicalTurn: 3,
            askedAt: new Date('2026-07-16T11:30:00.000Z'),
          },
        ]),
      },
      message: {
        count: jest.fn().mockResolvedValue(5),
      },
    };
    const snapshotBuilder = {
      build: jest.fn().mockResolvedValue(snapshot),
    };
    const adaptiveDecision = Object.freeze({
      intent: 'DIET_PLAN_REQUEST',
      shouldAsk: true,
      selectedCandidate: Object.freeze({
        field: 'MEAL_COUNT',
        state: 'READY_TO_ASK',
      }),
      orderedCandidates: Object.freeze([]),
      readiness: Object.freeze([]),
      reason: 'FIELD_SELECTED',
    });
    const collector = {
      decide: jest.fn().mockReturnValue(adaptiveDecision),
    };
    const planner = {
      plan: jest.fn().mockReturnValue({
        goal: CONVERSATION_GOAL.ASK_PROFILE_INFORMATION,
      }),
    };
    const specification = Object.freeze({
      field: CoachProfileAcquisitionField.DESIRED_MEAL_COUNT,
      questionKind: 'INTEGER' as const,
      responseType: 'INTEGER' as const,
      allowedOptions: Object.freeze([]),
      allowsFreeText: true,
      confirmationPolicy: 'IMPLICIT_ON_VALID_RESPONSE' as const,
      reasonCode: 'MISSING_CONTEXTUAL_FIELD' as const,
      version: 1,
      templateCode: 'PROFILE_QUESTION_DESIRED_MEAL_COUNT_V1',
    });
    const questions = {
      toCollectorField: jest
        .fn()
        .mockReturnValueOnce('MEAL_COUNT')
        .mockReturnValueOnce('FOOD_INTOLERANCES'),
      fromDecision: jest.fn().mockReturnValue(specification),
    };
    const service = new ProfileAcquisitionRuntimeService(
      prisma as unknown as PrismaService,
      snapshotBuilder as unknown as CoachProfileSnapshotBuilder,
      collector as unknown as CoachAdaptiveProfileCollectorService,
      planner as unknown as ConversationGoalPlannerService,
      questions as unknown as ProfileQuestionSpecificationService,
    );
    const referenceDate = new Date('2026-07-16T12:00:00.000Z');

    await expect(service.evaluate('admin-id', referenceDate)).resolves.toEqual({
      evaluation: {
        logicalTurn: 5,
        selectedField: CoachProfileAcquisitionField.DESIRED_MEAL_COUNT,
        canAsk: true,
        reason: 'READY',
      },
      specification,
    });
    expect(snapshotBuilder.build).toHaveBeenCalledWith(
      'admin-id',
      referenceDate,
    );
    expect(collector.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot,
        recentHistory: {
          currentLogicalTurn: 5,
          interactions: [
            {
              field: 'MEAL_COUNT',
              outcome: 'ASKED',
              logicalTurn: 2,
            },
            {
              field: 'FOOD_INTOLERANCES',
              outcome: 'DECLINED',
              logicalTurn: 3,
            },
          ],
        },
      }),
    );
    expect(planner.plan).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot,
        recognizedIntent: CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST,
        adaptiveDecision,
      }),
    );
    expect(
      Object.isFrozen(await service.evaluate('admin-id', referenceDate)),
    ).toBe(true);
  });

  it('uses the canonical current-turn context when selecting the persistent workout question', async () => {
    const snapshot = {
      completion: { overall: 'PARTIAL', sections: Object.freeze([]) },
    } as unknown as CoachProfileSnapshot;
    const prisma = {
      coachProfileAcquisitionCycle: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      message: { count: jest.fn().mockResolvedValue(1) },
    };
    const snapshotBuilder = { build: jest.fn().mockResolvedValue(snapshot) };
    const adaptiveDecision = Object.freeze({
      intent: 'WORKOUT_PLAN_REQUEST',
      shouldAsk: true,
      selectedCandidate: Object.freeze({
        field: 'TRAINING_EXPERIENCE',
        state: 'READY_TO_ASK',
      }),
      orderedCandidates: Object.freeze([]),
      readiness: Object.freeze([
        Object.freeze({
          plan: 'WORKOUT',
          ready: false,
          blockingFields: Object.freeze([
            'TRAINING_EXPERIENCE',
            'TRAINING_EQUIPMENT',
          ]),
        }),
      ]),
      reason: 'FIELD_SELECTED',
    });
    const collector = { decide: jest.fn().mockReturnValue(adaptiveDecision) };
    const planner = {
      plan: jest.fn().mockReturnValue({
        goal: CONVERSATION_GOAL.ASK_PROFILE_INFORMATION,
      }),
    };
    const specification = Object.freeze({
      field: CoachProfileAcquisitionField.TRAINING_EXPERIENCE,
      questionKind: 'SINGLE_SELECT' as const,
      responseType: 'SINGLE_SELECT' as const,
      allowedOptions: Object.freeze([]),
      allowsFreeText: true,
      confirmationPolicy: 'IMPLICIT_ON_VALID_RESPONSE' as const,
      reasonCode: 'MISSING_CONTEXTUAL_FIELD' as const,
      version: 1,
      templateCode: 'PROFILE_QUESTION_TRAINING_EXPERIENCE_V1',
    });
    const questions = {
      toCollectorField: jest.fn(),
      fromDecision: jest.fn().mockReturnValue(specification),
    };
    const service = new ProfileAcquisitionRuntimeService(
      prisma as unknown as PrismaService,
      snapshotBuilder as unknown as CoachProfileSnapshotBuilder,
      collector as unknown as CoachAdaptiveProfileCollectorService,
      planner as unknown as ConversationGoalPlannerService,
      questions as unknown as ProfileQuestionSpecificationService,
    );
    const context = Object.freeze({
      modality: Object.freeze({
        value: 'GYM' as const,
        evidence: 'EXPLICIT' as const,
      }),
      environment: Object.freeze({
        value: 'FULL_GYM',
        evidence: 'EXPLICIT' as const,
      }),
      weeklyFrequency: Object.freeze({
        value: 4,
        evidence: 'EXPLICIT' as const,
      }),
      sessionDurationMinutes: Object.freeze({
        value: 60,
        evidence: 'EXPLICIT' as const,
      }),
    });

    await expect(
      service.evaluate(
        'user-id',
        new Date('2026-08-19T12:00:00.000Z'),
        PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST,
        context,
      ),
    ).resolves.toMatchObject({
      evaluation: {
        selectedField: CoachProfileAcquisitionField.TRAINING_EXPERIENCE,
        canAsk: true,
      },
    });
    expect(collector.decide).toHaveBeenCalledWith(
      expect.objectContaining({ conversationContext: context }),
    );
    expect(adaptiveDecision.readiness[0].blockingFields).not.toEqual(
      expect.arrayContaining([
        'TRAINING_MODALITY',
        'TRAINING_ENVIRONMENT',
        'TRAINING_FREQUENCY',
        'SESSION_DURATION',
      ]),
    );
  });
});
