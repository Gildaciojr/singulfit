import {
  PROFILE_ACQUISITION_INTENT,
  type ProfileAcquisitionDecision,
} from '../../context/coach-adaptive-profile-collector.contract';
import type { CoachProfileSnapshot } from '../../context/coach-profile-snapshot.contract';
import {
  CONVERSATION_GOAL,
  CONVERSATION_RECOGNIZED_INTENT,
  type ConversationGoalDecision,
} from '../../context/conversation-goal-planner.contract';
import { CoachProfileSnapshotConversationAdapter } from '../adapters/coach-profile-snapshot.adapter';
import { ConversationGoalDecisionAdapter } from '../adapters/conversation-goal-decision.adapter';
import { ProfileAcquisitionDecisionConversationAdapter } from '../adapters/profile-acquisition-decision.adapter';

describe('Conversation adapters', () => {
  it('projects Snapshot facts without exposing plan identifiers or document content', () => {
    const snapshot = {
      completion: {
        overall: 'PARTIAL',
        sections: [
          {
            missingFields: ['AGE'],
            confirmationRequiredFields: ['CURRENT_WEIGHT'],
          },
          { missingFields: ['AGE'], confirmationRequiredFields: [] },
        ],
      },
      plans: {
        currentDiet: { status: 'KNOWN', value: { id: 'private-diet-id' } },
        currentWorkout: { status: 'UNKNOWN', sources: [] },
      },
      longitudinal: {
        latestProgressWeightKg: { status: 'KNOWN', value: 80 },
        goalProgression: { status: 'UNKNOWN', sources: [] },
        nutritionEvolution: { status: 'UNKNOWN', sources: [] },
      },
      restrictions: {
        medicalConditions: { status: 'UNKNOWN', sources: [] },
        physicalLimitations: {
          status: 'KNOWN',
          value: [{ type: 'PAIN', description: 'joelho' }],
        },
        allergies: { status: 'UNKNOWN', sources: [] },
      },
      conflicts: [],
      referenceDate: '2026-08-01',
    } as unknown as CoachProfileSnapshot;

    const result = new CoachProfileSnapshotConversationAdapter().adapt(
      snapshot,
    );

    expect(result).toEqual({
      completion: 'PARTIAL',
      missingFields: ['AGE'],
      confirmationRequiredFields: ['CURRENT_WEIGHT'],
      currentPlans: { dietAvailable: true, workoutAvailable: false },
      progressContextAvailable: true,
      safetyContextPresent: true,
      conflictCount: 0,
      referenceDate: '2026-08-01',
    });
    expect(JSON.stringify(result)).not.toContain('private-diet-id');
  });

  it('projects Collector readiness without changing its decision', () => {
    const decision: ProfileAcquisitionDecision = {
      intent: PROFILE_ACQUISITION_INTENT.DIET_PLAN_REQUEST,
      shouldAsk: false,
      selectedCandidate: null,
      orderedCandidates: [],
      readiness: [
        { plan: 'DIET', ready: true, blockingFields: [] },
        {
          plan: 'WORKOUT',
          ready: false,
          blockingFields: ['TRAINING_MODALITY'],
        },
      ],
      reason: 'PROFILE_READY',
    };

    expect(
      new ProfileAcquisitionDecisionConversationAdapter().adapt(decision),
    ).toEqual({
      intent: PROFILE_ACQUISITION_INTENT.DIET_PLAN_REQUEST,
      shouldAsk: false,
      selectedField: null,
      readyPlans: ['DIET'],
      blockedPlans: ['WORKOUT'],
      reason: 'PROFILE_READY',
    });
  });

  it('adapts a current Planner decision as compatibility evidence', () => {
    const decision = goalDecision({
      recognizedIntent: CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST,
      goal: CONVERSATION_GOAL.GENERATE_DIET_PLAN,
      targetPlan: 'DIET',
    });
    const result = new ConversationGoalDecisionAdapter().adapt(decision, {
      operationKey: 'planner-adapter:test',
      evaluatedAt: '2026-08-01T12:00:00.000Z',
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'UNDERSTOOD',
        operation: 'GENERATE_PLAN',
        domain: 'NUTRITION',
        references: [
          expect.objectContaining({ kind: 'PLAN', domain: 'NUTRITION' }),
        ],
        metadata: expect.objectContaining({
          source: 'CURRENT_PLANNER_ADAPTER',
        }),
      }),
    );
  });

  it('preserves an unknown Planner decision as an explicit failure', () => {
    const result = new ConversationGoalDecisionAdapter().adapt(
      goalDecision({
        recognizedIntent: CONVERSATION_RECOGNIZED_INTENT.UNKNOWN,
        goal: CONVERSATION_GOAL.UNKNOWN,
        targetPlan: null,
      }),
      {
        operationKey: 'planner-adapter:unknown',
        evaluatedAt: '2026-08-01T12:00:00.000Z',
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: 'FAILED',
        failure: 'CONTEXT_UNAVAILABLE',
        operation: 'NONE',
        domain: 'UNKNOWN',
      }),
    );
  });

  it.each([
    [
      CONVERSATION_RECOGNIZED_INTENT.COMMON_MESSAGE,
      CONVERSATION_GOAL.ANSWER_MESSAGE,
      null,
      'ANSWER',
      'GENERAL',
    ],
    [
      CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST,
      CONVERSATION_GOAL.ASK_PROFILE_INFORMATION,
      'DIET',
      'GENERATE_PLAN',
      'NUTRITION',
    ],
    [
      CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_REQUEST,
      CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN,
      'WORKOUT',
      'GENERATE_PLAN',
      'WORKOUT',
    ],
    [
      CONVERSATION_RECOGNIZED_INTENT.COMBINED_PLAN_REQUEST,
      CONVERSATION_GOAL.GENERATE_COMBINED_PLANS,
      'BOTH',
      'GENERATE_PLAN',
      'COMBINED',
    ],
    [
      CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_UPDATE_REQUEST,
      CONVERSATION_GOAL.UPDATE_DIET_PLAN,
      'DIET',
      'UPDATE_PLAN',
      'NUTRITION',
    ],
    [
      CONVERSATION_RECOGNIZED_INTENT.WORKOUT_PLAN_UPDATE_REQUEST,
      CONVERSATION_GOAL.UPDATE_WORKOUT_PLAN,
      'WORKOUT',
      'UPDATE_PLAN',
      'WORKOUT',
    ],
    [
      CONVERSATION_RECOGNIZED_INTENT.PROGRESS_REVIEW_REQUEST,
      CONVERSATION_GOAL.REVIEW_PROGRESS,
      null,
      'REVIEW_PROGRESS',
      'PROGRESS',
    ],
    [
      CONVERSATION_RECOGNIZED_INTENT.CONFIRMATION_REQUIRED,
      CONVERSATION_GOAL.REQUEST_CONFIRMATION,
      null,
      'REQUEST_CONFIRMATION',
      'GENERAL',
    ],
    [
      CONVERSATION_RECOGNIZED_INTENT.CURRENT_PLAN_REQUEST,
      CONVERSATION_GOAL.SHOW_CURRENT_PLAN,
      null,
      'PRESENT_CURRENT_PLAN',
      'GENERAL',
    ],
    [
      CONVERSATION_RECOGNIZED_INTENT.PLAN_STATUS_REQUEST,
      CONVERSATION_GOAL.SHOW_PLAN_STATUS,
      null,
      'PRESENT_PLAN_STATUS',
      'GENERAL',
    ],
    [
      CONVERSATION_RECOGNIZED_INTENT.NUTRITION_QUESTION,
      CONVERSATION_GOAL.GENERAL_GUIDANCE,
      null,
      'PROVIDE_GUIDANCE',
      'NUTRITION',
    ],
    [
      CONVERSATION_RECOGNIZED_INTENT.GENERAL_GUIDANCE_REQUEST,
      CONVERSATION_GOAL.GENERAL_GUIDANCE,
      null,
      'PROVIDE_GUIDANCE',
      'GENERAL',
    ],
  ] as const)(
    'maps %s independently from Planner precondition goal',
    (recognizedIntent, goal, targetPlan, operation, domain) => {
      const result = new ConversationGoalDecisionAdapter().adapt(
        goalDecision({ recognizedIntent, goal, targetPlan }),
        {
          operationKey: `planner-adapter:${recognizedIntent}`,
          evaluatedAt: '2026-08-01T12:00:00.000Z',
        },
      );
      expect(result.operation).toBe(operation);
      expect(result.domain).toBe(domain);
    },
  );
});

function goalDecision(
  values: Pick<
    ConversationGoalDecision,
    'recognizedIntent' | 'goal' | 'targetPlan'
  >,
): ConversationGoalDecision {
  return {
    ...values,
    reason:
      values.goal === CONVERSATION_GOAL.UNKNOWN
        ? 'INTENT_NOT_RECOGNIZED'
        : 'DIET_PROFILE_READY',
    profileCompletionState: 'COMPLETE',
    canExecute: values.goal !== CONVERSATION_GOAL.UNKNOWN,
    confidence: values.goal === CONVERSATION_GOAL.UNKNOWN ? 'LOW' : 'HIGH',
    selectedProfileField: null,
    metPreconditions: [],
    missingPreconditions: [],
    pendingDependencies: [],
  };
}
