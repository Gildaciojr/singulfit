import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DietPlanStatus, FitnessGoal } from '@prisma/client';
import { CoachAdaptiveProfileCollectorService } from '../context/coach-adaptive-profile-collector.service';
import type { ProfileAcquisitionDecision } from '../context/coach-adaptive-profile-collector.contract';
import { CoachProfileSnapshotBuilder } from '../context/coach-profile-snapshot.builder';
import {
  COACH_PROFILE_DATA_SOURCE,
  COACH_PROFILE_KNOWLEDGE_STATUS,
  CoachProfileDatum,
  CoachProfileSnapshot,
} from '../context/coach-profile-snapshot.contract';
import {
  CONVERSATION_GOAL,
  CONVERSATION_RECOGNIZED_INTENT,
  ConversationGoalDecision,
} from '../context/conversation-goal-planner.contract';
import { ConversationGoalPlannerService } from '../context/conversation-goal-planner.service';
import { AuditService } from '../observability/audit.service';
import { ConversationGoalShadowComparator } from './conversation-goal-shadow-comparator';
import { ConversationGoalShadowConfigService } from './conversation-goal-shadow-config.service';
import type { ConversationGoalShadowComparison } from './conversation-goal-shadow-comparison.contract';
import { ConversationGoalShadowPipelineService } from './conversation-goal-shadow-pipeline.service';
import { LegacyCoachIntentAdapter } from './legacy-coach-intent.adapter';
import type { LegacyCoachIntentAdaptation } from './legacy-coach-intent-adapter.contract';

describe('ConversationGoalShadowPipelineService', () => {
  function unknown<T>(): CoachProfileDatum<T> {
    return Object.freeze({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.UNKNOWN,
      sources: Object.freeze([]),
    });
  }

  function known<T>(value: T): CoachProfileDatum<T> {
    return Object.freeze({
      status: COACH_PROFILE_KNOWLEDGE_STATUS.KNOWN,
      value,
      sources: Object.freeze([COACH_PROFILE_DATA_SOURCE.USER]),
    });
  }

  function snapshot(): CoachProfileSnapshot {
    return Object.freeze({
      identity: Object.freeze({
        userId: known('user-id'),
        displayName: known('Ana'),
        onboardingCompleted: known(true),
      }),
      physical: Object.freeze({
        sex: unknown(),
        birthDate: unknown(),
        ageYears: unknown(),
        heightCm: unknown(),
        currentWeightKg: unknown(),
        targetWeightKg: unknown(),
        activityLevel: unknown(),
      }),
      nutrition: Object.freeze({
        primaryGoal: unknown(),
        desiredOutcome: unknown(),
        desiredMealCount: unknown(),
        dietaryPattern: unknown(),
        cookingAvailability: unknown(),
        mealsAwayFromHome: unknown(),
        foodBudget: unknown(),
        supplementation: unknown(),
        hydration: unknown(),
      }),
      training: Object.freeze({
        primaryGoal: unknown(),
        experienceLevel: unknown(),
        preferredModality: unknown(),
        weeklyFrequency: unknown(),
        sessionDurationMinutes: unknown(),
        environment: unknown(),
        availableEquipment: unknown(),
        perceivedConditioning: unknown(),
        intensityPreference: unknown(),
        cardioAvailability: unknown(),
        trainingFormatPreference: unknown(),
      }),
      routine: Object.freeze({
        wakeUpTime: unknown(),
        sleepTime: unknown(),
        trainingTime: unknown(),
        mealTimes: unknown(),
      }),
      restrictions: Object.freeze({
        foodRestrictions: unknown(),
        allergies: unknown(),
        medicalConditions: unknown(),
        physicalLimitations: unknown(),
      }),
      preferences: Object.freeze({ foodPreferences: unknown() }),
      longitudinal: Object.freeze({
        adherenceScore: unknown(),
        latestProgressWeightKg: unknown(),
        goalProgression: unknown(),
        nutritionEvolution: unknown(),
        coachAdaptation: unknown(),
      }),
      plans: Object.freeze({
        currentDiet: unknown(),
        currentWorkout: unknown(),
      }),
      conversation: Object.freeze({
        preferredLanguage: unknown(),
        timezone: unknown(),
        coachStyle: unknown(),
        behavioralStyle: unknown(),
        behavioralStage: unknown(),
        classifiedGoal: unknown(),
        memorySummaries: unknown(),
      }),
      completion: Object.freeze({
        overall: 'INSUFFICIENT',
        sections: Object.freeze([]),
      }),
      conflicts: Object.freeze([]),
      referenceDate: '2026-07-15T12:00:00.000Z',
    });
  }

  const adaptation: LegacyCoachIntentAdaptation = Object.freeze({
    legacyIntent: 'DIET',
    recognizedIntent: CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST,
    acquisitionIntent: 'DIET_PLAN_REQUEST',
    planTarget: 'DIET',
    certainty: 'EXPLICIT',
    adapterVersion: 'legacy-coach-intent-adapter:v1',
  });

  const adaptiveDecision: ProfileAcquisitionDecision = Object.freeze({
    intent: 'DIET_PLAN_REQUEST',
    shouldAsk: false,
    selectedCandidate: null,
    orderedCandidates: Object.freeze([]),
    readiness: Object.freeze([
      Object.freeze({
        plan: 'DIET',
        ready: true,
        blockingFields: Object.freeze([]),
      }),
      Object.freeze({
        plan: 'WORKOUT',
        ready: true,
        blockingFields: Object.freeze([]),
      }),
    ]),
    reason: 'PROFILE_READY',
  });

  const plannerDecision: ConversationGoalDecision = Object.freeze({
    recognizedIntent: CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST,
    goal: CONVERSATION_GOAL.GENERATE_DIET_PLAN,
    reason: 'DIET_PROFILE_READY',
    targetPlan: 'DIET',
    profileCompletionState: 'COMPLETE',
    canExecute: true,
    confidence: 'HIGH',
    selectedProfileField: null,
    metPreconditions: Object.freeze([]),
    missingPreconditions: Object.freeze([]),
    pendingDependencies: Object.freeze([]),
  });

  const comparison: ConversationGoalShadowComparison = Object.freeze({
    legacyDecision: 'DIET',
    plannerGoal: CONVERSATION_GOAL.GENERATE_DIET_PLAN,
    agreement: true,
    category: 'EXACT_MATCH',
    canExecute: true,
    missingProfileField: null,
    adaptedIntent: CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST,
    targetPlan: 'DIET',
    profileCompletionState: 'COMPLETE',
    sanitizedReason: 'DIET_PROFILE_READY',
    adapterVersion: 'legacy-coach-intent-adapter:v1',
    plannerVersion: 'conversation-goal-planner:v1',
    comparatorVersion: 'conversation-goal-shadow-comparator:v1',
    referenceTimestamp: '2026-07-15T12:00:00.000Z',
  });

  async function subject(
    enabled = true,
    profile: CoachProfileSnapshot = snapshot(),
  ) {
    const config = {
      get: jest.fn().mockReturnValue({ requested: enabled, enabled }),
    };
    const adapter = { adapt: jest.fn().mockReturnValue(adaptation) };
    const snapshotBuilder = { build: jest.fn().mockResolvedValue(profile) };
    const collector = { decide: jest.fn().mockReturnValue(adaptiveDecision) };
    const planner = { plan: jest.fn().mockReturnValue(plannerDecision) };
    const comparator = { compare: jest.fn().mockReturnValue(comparison) };
    const audit = { record: jest.fn().mockResolvedValue({ id: 'audit-id' }) };
    const module = await Test.createTestingModule({
      providers: [
        ConversationGoalShadowPipelineService,
        { provide: ConversationGoalShadowConfigService, useValue: config },
        { provide: LegacyCoachIntentAdapter, useValue: adapter },
        { provide: CoachProfileSnapshotBuilder, useValue: snapshotBuilder },
        { provide: CoachAdaptiveProfileCollectorService, useValue: collector },
        { provide: ConversationGoalPlannerService, useValue: planner },
        { provide: ConversationGoalShadowComparator, useValue: comparator },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    return {
      service: module.get(ConversationGoalShadowPipelineService),
      profile,
      config,
      adapter,
      snapshotBuilder,
      collector,
      planner,
      comparator,
      audit,
    };
  }

  const input = Object.freeze({
    userId: 'user-id',
    messageId: 'message-id',
    legacyIntent: 'DIET' as const,
    referenceTimestamp: '2026-07-15T12:00:00.000Z',
    onboardingActive: false,
    equivalentGenerationInProgress: false,
  });

  async function flush(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  it('runs the complete shadow sequence once and reuses one snapshot', async () => {
    const setup = await subject();

    setup.service.execute(input);
    await flush();

    expect(setup.snapshotBuilder.build).toHaveBeenCalledTimes(1);
    expect(setup.snapshotBuilder.build).toHaveBeenCalledWith(
      'user-id',
      new Date('2026-07-15T12:00:00.000Z'),
    );
    const collectorInput = setup.collector.decide.mock.calls[0][0];
    const goalInput = setup.planner.plan.mock.calls[0][0];
    expect(collectorInput.snapshot).toBe(setup.profile);
    expect(goalInput.snapshot).toBe(setup.profile);
    expect(collectorInput.memory.interactions).toEqual([]);
    expect(collectorInput.recentHistory.interactions).toEqual([]);
    expect(goalInput.recentHistory.entries).toEqual([]);
    expect(Object.isFrozen(collectorInput)).toBe(true);
    expect(Object.isFrozen(goalInput)).toBe(true);
    expect(setup.comparator.compare).toHaveBeenCalledTimes(1);
    expect(setup.comparator.compare).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot: setup.profile }),
    );
    expect(setup.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id',
        entityId: 'message-id',
        metadata: expect.objectContaining({
          legacyIntent: 'DIET',
          plannerGoal: 'GENERATE_DIET_PLAN',
          comparisonCategory: 'EXACT_MATCH',
          acquisitionHistoryAvailable: false,
          goalHistoryAvailable: false,
          activeDietAvailable: false,
          activeWorkoutAvailable: false,
        }),
      }),
    );
    expect(
      setup.snapshotBuilder.build.mock.invocationCallOrder[0],
    ).toBeLessThan(setup.collector.decide.mock.invocationCallOrder[0]);
    expect(setup.collector.decide.mock.invocationCallOrder[0]).toBeLessThan(
      setup.planner.plan.mock.invocationCallOrder[0],
    );
    expect(setup.planner.plan.mock.invocationCallOrder[0]).toBeLessThan(
      setup.comparator.compare.mock.invocationCallOrder[0],
    );
  });

  it('does nothing while disabled or while onboarding owns the message', async () => {
    const disabled = await subject(false);
    disabled.service.execute(input);
    const onboarding = await subject(true);
    onboarding.service.execute({ ...input, onboardingActive: true });
    await flush();

    expect(disabled.snapshotBuilder.build).not.toHaveBeenCalled();
    expect(onboarding.snapshotBuilder.build).not.toHaveBeenCalled();
    expect(disabled.audit.record).not.toHaveBeenCalled();
    expect(onboarding.audit.record).not.toHaveBeenCalled();
  });

  it('deduplicates the same message in-process without global user cache', async () => {
    const setup = await subject();

    setup.service.execute(input);
    setup.service.execute(input);
    await flush();

    expect(setup.snapshotBuilder.build).toHaveBeenCalledTimes(1);
    expect(setup.audit.record).toHaveBeenCalledTimes(1);
  });

  it('translates an explicitly known in-progress generation into logical goal history', async () => {
    const setup = await subject();

    setup.service.execute({
      ...input,
      equivalentGenerationInProgress: true,
    });
    await flush();

    expect(setup.planner.plan).toHaveBeenCalledWith(
      expect.objectContaining({
        recentHistory: {
          currentLogicalTurn: 0,
          entries: [
            {
              goal: 'GENERATE_DIET_PLAN',
              status: 'EXECUTING',
              logicalTurn: 0,
            },
          ],
        },
      }),
    );
    expect(setup.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ goalHistoryAvailable: true }),
      }),
    );
  });

  it.each(['COMPLETE', 'INSUFFICIENT'] as const)(
    'passes a %s profile completion state without changing it',
    async (completionState) => {
      const profile = Object.freeze({
        ...snapshot(),
        completion: Object.freeze({
          overall: completionState,
          sections: Object.freeze([]),
        }),
      });
      const setup = await subject(true, profile);

      setup.service.execute(input);
      await flush();

      expect(setup.planner.plan).toHaveBeenCalledWith(
        expect.objectContaining({ completion: profile.completion }),
      );
      expect(setup.profile).toBe(profile);
    },
  );

  it('reports an active plan from the reused snapshot without another query', async () => {
    const profile = Object.freeze({
      ...snapshot(),
      plans: Object.freeze({
        currentDiet: known(
          Object.freeze({
            id: 'diet-id',
            title: 'Plano alimentar',
            objective: FitnessGoal.WEIGHT_LOSS,
            status: DietPlanStatus.ACTIVE,
            generatedAt: '2026-07-15T11:00:00.000Z',
          }),
        ),
        currentWorkout: unknown(),
      }),
    });
    const setup = await subject(true, profile);

    setup.service.execute(input);
    await flush();

    expect(setup.snapshotBuilder.build).toHaveBeenCalledTimes(1);
    expect(setup.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          activeDietAvailable: true,
          activeWorkoutAvailable: false,
        }),
      }),
    );
  });

  it.each([
    ['INTENT_ADAPTER', 'INTENT_ADAPTER_FAILED'],
    ['SNAPSHOT', 'SNAPSHOT_BUILD_FAILED'],
    ['COLLECTOR', 'COLLECTOR_FAILED'],
    ['PLANNER', 'PLANNER_FAILED'],
    ['COMPARISON', 'COMPARISON_FAILED'],
  ] as const)('isolates a %s failure as %s', async (stage, code) => {
    const setup = await subject();
    const failure = new Error('sensitive internal failure');

    if (stage === 'INTENT_ADAPTER')
      setup.adapter.adapt.mockImplementation(() => {
        throw failure;
      });
    if (stage === 'SNAPSHOT')
      setup.snapshotBuilder.build.mockRejectedValue(failure);
    if (stage === 'COLLECTOR')
      setup.collector.decide.mockImplementation(() => {
        throw failure;
      });
    if (stage === 'PLANNER')
      setup.planner.plan.mockImplementation(() => {
        throw failure;
      });
    if (stage === 'COMPARISON')
      setup.comparator.compare.mockImplementation(() => {
        throw failure;
      });

    expect(() => setup.service.execute(input)).not.toThrow();
    await flush();

    expect(setup.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CONVERSATION_GOAL_SHADOW_FAILED',
        metadata: expect.objectContaining({ failureCode: code }),
      }),
    );
    expect(JSON.stringify(setup.audit.record.mock.calls)).not.toContain(
      'sensitive internal failure',
    );
  });

  it('absorbs audit failure without retrying functional work', async () => {
    const setup = await subject();
    setup.audit.record
      .mockRejectedValueOnce(new Error('audit unavailable'))
      .mockResolvedValueOnce({ id: 'failure-audit-id' });

    expect(() => setup.service.execute(input)).not.toThrow();
    await flush();

    expect(setup.snapshotBuilder.build).toHaveBeenCalledTimes(1);
    expect(setup.audit.record).toHaveBeenCalledTimes(2);
    expect(setup.audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ failureCode: 'AUDIT_FAILED' }),
      }),
    );
  });

  it('contains no producer dependency capable of sending or executing plans', () => {
    const source = readFileSync(
      join(__dirname, 'conversation-goal-shadow-pipeline.service.ts'),
      'utf8',
    );

    expect(source).not.toMatch(
      /DietGeneratorService|WorkoutGeneratorService|EvolutionSendService|OutboundMessage|EventBusService|AIService|PromptService|ScheduledMessage/,
    );
  });
});
