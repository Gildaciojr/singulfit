import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoachAdaptiveProfileCollectorService } from '../context/coach-adaptive-profile-collector.service';
import { ConversationGoalPlannerService } from '../context/conversation-goal-planner.service';
import { NutritionPlanningStrategyService } from '../diet/v2/nutrition-planning-strategy.service';
import { LongitudinalCoachingEngineService } from '../longitudinal-coaching/longitudinal-coaching-engine.service';
import { NutritionKnowledgeResolverService } from '../nutrition-knowledge/nutrition-knowledge-resolver.service';
import { NutritionReasoningEngineService } from '../nutrition-reasoning/nutrition-reasoning-engine.service';
import {
  CONVERSATION_LAYER_MODE,
  ConversationLayerOperationalConfigService,
} from '../responses/conversation-layer-operational-config.service';
import { WorkoutKnowledgeResolverService } from '../workout-knowledge/workout-knowledge-resolver.service';
import { WorkoutReasoningEngineService } from '../workout-reasoning/workout-reasoning-engine.service';
import { WorkoutPlanningStrategyService } from '../workout/v2/workout-planning-strategy.service';
import { NutritionReasoningShadowAdapter } from './nutrition-reasoning-shadow.adapter';
import { UnifiedShadowDecisionAuditService } from './unified-shadow-decision-audit.service';
import { UnifiedShadowDecisionComparator } from './unified-shadow-decision-comparator';
import {
  UNIFIED_SHADOW_ADAPTER_VERSION,
  UNIFIED_SHADOW_COMPARATOR_VERSION,
  UNIFIED_SHADOW_COMPARISON_CATEGORY,
  UNIFIED_SHADOW_PIPELINE_VERSION,
  UnifiedShadowDecisionPipelineInput,
} from './unified-shadow-decision.contract';
import { UnifiedShadowDecisionPipelineService } from './unified-shadow-decision-pipeline.service';
import { WorkoutReasoningShadowAdapter } from './workout-reasoning-shadow.adapter';

describe('UnifiedShadowDecisionPipelineService', () => {
  function fixture<T>(value: unknown): T {
    return value as T;
  }

  function createSubject(mode: string = CONVERSATION_LAYER_MODE.SHADOW) {
    const operationalConfig = {
      get: jest.fn(() => ({ effectiveMode: mode })),
    } as unknown as ConversationLayerOperationalConfigService;
    const collector = {
      decide: jest.fn(() =>
        fixture<ReturnType<CoachAdaptiveProfileCollectorService['decide']>>({
          shouldAsk: false,
        }),
      ),
    } as unknown as CoachAdaptiveProfileCollectorService;
    const planner = {
      plan: jest.fn(() =>
        fixture<ReturnType<ConversationGoalPlannerService['plan']>>({
          goal: 'GENERATE_COMBINED_PLANS',
        }),
      ),
    } as unknown as ConversationGoalPlannerService;
    const longitudinal = {
      decide: jest.fn(() =>
        fixture<ReturnType<LongitudinalCoachingEngineService['decide']>>({
          decision: 'KEEP_PLAN',
          metadata: { policyVersion: '2026.07.1' },
        }),
      ),
    } as unknown as LongitudinalCoachingEngineService;
    const nutritionKnowledge = {
      resolve: jest.fn(() => ({ packages: [] })),
    } as unknown as NutritionKnowledgeResolverService;
    const nutritionReasoning = {
      reason: jest.fn(() =>
        fixture<ReturnType<NutritionReasoningEngineService['reason']>>({
          interventionIntensity: 'LOW',
          recommendedComplexity: 'MINIMAL',
          metadata: { strategyVersion: '2026.07.1' },
        }),
      ),
    } as unknown as NutritionReasoningEngineService;
    const workoutKnowledge = {
      resolve: jest.fn(() => ({ packages: [] })),
    } as unknown as WorkoutKnowledgeResolverService;
    const workoutReasoning = {
      reason: jest.fn(() =>
        fixture<ReturnType<WorkoutReasoningEngineService['reason']>>({
          interventionIntensity: 'LOW',
          authorizedComplexity: 'MINIMAL',
          progressionDecision: 'MAINTAIN',
          metadata: { strategyVersion: '2026.07.1' },
        }),
      ),
    } as unknown as WorkoutReasoningEngineService;
    const nutritionStrategy = {
      build: jest.fn(() =>
        fixture<ReturnType<NutritionPlanningStrategyService['build']>>({}),
      ),
    } as unknown as NutritionPlanningStrategyService;
    const workoutStrategy = {
      build: jest.fn(() =>
        fixture<ReturnType<WorkoutPlanningStrategyService['build']>>({}),
      ),
    } as unknown as WorkoutPlanningStrategyService;
    const nutritionAdapter = {
      adapt: jest.fn(() =>
        fixture<ReturnType<NutritionReasoningShadowAdapter['adapt']>>({
          selectedStrategies: ['ENERGY_BALANCE'],
        }),
      ),
    } as unknown as NutritionReasoningShadowAdapter;
    const workoutAdapter = {
      adapt: jest.fn(() =>
        fixture<ReturnType<WorkoutReasoningShadowAdapter['adapt']>>({
          selectedStrategies: ['ADHERENCE_FIRST'],
        }),
      ),
    } as unknown as WorkoutReasoningShadowAdapter;
    const comparison = Object.freeze({
      comparatorVersion: UNIFIED_SHADOW_COMPARATOR_VERSION,
      nutrition: Object.freeze({
        category: UNIFIED_SHADOW_COMPARISON_CATEGORY.COMPATIBLE,
        exact: false,
        differences: Object.freeze([]),
      }),
      workout: Object.freeze({
        category: UNIFIED_SHADOW_COMPARISON_CATEGORY.MORE_CONSERVATIVE,
        exact: false,
        differences: Object.freeze([]),
      }),
      longitudinal: Object.freeze({
        category: UNIFIED_SHADOW_COMPARISON_CATEGORY.EXACT_MATCH,
        exact: true,
        differences: Object.freeze([]),
      }),
      overallCategory: UNIFIED_SHADOW_COMPARISON_CATEGORY.MORE_CONSERVATIVE,
    });
    const comparator = {
      compare: jest.fn(() => comparison),
    } as unknown as UnifiedShadowDecisionComparator;
    const audit = {
      recordCompleted: jest.fn(() => Promise.resolve()),
      recordFailed: jest.fn(() => Promise.resolve()),
    } as unknown as UnifiedShadowDecisionAuditService;

    return {
      service: new UnifiedShadowDecisionPipelineService(
        operationalConfig,
        collector,
        planner,
        longitudinal,
        nutritionKnowledge,
        nutritionReasoning,
        workoutKnowledge,
        workoutReasoning,
        nutritionStrategy,
        workoutStrategy,
        nutritionAdapter,
        workoutAdapter,
        comparator,
        audit,
      ),
      dependencies: {
        operationalConfig,
        collector,
        planner,
        longitudinal,
        nutritionKnowledge,
        nutritionReasoning,
        workoutKnowledge,
        workoutReasoning,
        nutritionStrategy,
        workoutStrategy,
        nutritionAdapter,
        workoutAdapter,
        comparator,
        audit,
      },
    };
  }

  function input(): UnifiedShadowDecisionPipelineInput {
    return fixture<UnifiedShadowDecisionPipelineInput>({
      operation: { userId: 'user-id', auditEntityId: 'message-id' },
      snapshot: { completion: {} },
      collector: {},
      planner: {},
      longitudinal: {},
      nutrition: {
        planningContext: { artifactType: 'POINT_GUIDANCE' },
      },
      workout: {
        planningContext: { artifactType: 'POINT_GUIDANCE' },
        recognizedModality: 'GENERAL_FITNESS',
      },
      legacyLongitudinalDecision: 'KEEP_PLAN',
    });
  }

  it('executes every decision component only in SHADOW and audits metadata', async () => {
    const subject = createSubject();
    const pipelineInput = input();
    const before = JSON.stringify(pipelineInput);

    const result = await subject.service.execute(pipelineInput);

    expect(result.status).toBe('COMPLETED');
    expect(subject.dependencies.collector.decide).toHaveBeenCalledTimes(1);
    expect(subject.dependencies.planner.plan).toHaveBeenCalledTimes(1);
    expect(subject.dependencies.longitudinal.decide).toHaveBeenCalledTimes(1);
    expect(
      subject.dependencies.nutritionKnowledge.resolve,
    ).toHaveBeenCalledTimes(1);
    expect(
      subject.dependencies.nutritionReasoning.reason,
    ).toHaveBeenCalledTimes(1);
    expect(subject.dependencies.workoutKnowledge.resolve).toHaveBeenCalledTimes(
      1,
    );
    expect(subject.dependencies.workoutReasoning.reason).toHaveBeenCalledTimes(
      1,
    );
    expect(subject.dependencies.nutritionStrategy.build).toHaveBeenCalledTimes(
      1,
    );
    expect(subject.dependencies.workoutStrategy.build).toHaveBeenCalledTimes(1);
    expect(subject.dependencies.nutritionAdapter.adapt).toHaveBeenCalledTimes(
      1,
    );
    expect(subject.dependencies.workoutAdapter.adapt).toHaveBeenCalledTimes(1);
    expect(subject.dependencies.comparator.compare).toHaveBeenCalledTimes(1);
    expect(subject.dependencies.audit.recordCompleted).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(pipelineInput)).toBe(before);
    expect(Object.isFrozen(result)).toBe(true);

    if (result.status === 'COMPLETED') {
      expect(result.artifacts.adaptiveDecision).toBe(
        jest.mocked(subject.dependencies.collector.decide).mock.results[0]
          .value,
      );
      expect(result.artifacts.plannerDecision).toBe(
        jest.mocked(subject.dependencies.planner.plan).mock.results[0].value,
      );
      expect(result.artifacts.longitudinalDecision).toBe(
        jest.mocked(subject.dependencies.longitudinal.decide).mock.results[0]
          .value,
      );
      expect(subject.dependencies.comparator.compare).toHaveBeenCalledWith({
        nutritionLegacy: result.artifacts.nutritionLegacyStrategy,
        nutritionShadow: result.artifacts.nutritionShadowStrategy,
        workoutLegacy: result.artifacts.workoutLegacyStrategy,
        workoutShadow: result.artifacts.workoutShadowStrategy,
        longitudinalLegacy: pipelineInput.legacyLongitudinalDecision,
        longitudinalShadow: result.artifacts.longitudinalDecision,
      });
      expect(result.comparison).toBe(
        jest.mocked(subject.dependencies.comparator.compare).mock.results[0]
          .value,
      );
      expect(result.auditMetadata.versions).toMatchObject({
        adapter: UNIFIED_SHADOW_ADAPTER_VERSION,
        comparator: UNIFIED_SHADOW_COMPARATOR_VERSION,
        pipeline: UNIFIED_SHADOW_PIPELINE_VERSION,
      });
      expect(Object.isFrozen(result.auditMetadata)).toBe(true);
      expect(Object.isFrozen(result.artifacts)).toBe(true);
      expect(Object.isFrozen(result.artifacts.adaptiveDecision)).toBe(true);
      expect(JSON.parse(JSON.stringify(result.artifacts))).toEqual(
        result.artifacts,
      );
      expect(subject.dependencies.audit.recordCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: result.auditMetadata }),
      );
      expect(JSON.stringify(result.auditMetadata)).not.toMatch(
        /message|freeText|prompt|chainOfThought|responseText/i,
      );
    }
  });

  it('skips without touching components outside SHADOW', async () => {
    const subject = createSubject(CONVERSATION_LAYER_MODE.OFF);

    const result = await subject.service.execute(input());

    expect(result).toEqual({
      status: 'SKIPPED',
      reason: 'MODE_NOT_SHADOW',
    });
    expect('artifacts' in result).toBe(false);
    expect(subject.dependencies.collector.decide).not.toHaveBeenCalled();
    expect(subject.dependencies.audit.recordCompleted).not.toHaveBeenCalled();
    expect(subject.dependencies.audit.recordFailed).not.toHaveBeenCalled();
  });

  it.each([
    ['collector', 'decide', 'COLLECTOR_FAILED'],
    ['planner', 'plan', 'PLANNER_FAILED'],
    ['longitudinal', 'decide', 'LONGITUDINAL_FAILED'],
    ['nutritionReasoning', 'reason', 'NUTRITION_REASONING_FAILED'],
    ['workoutReasoning', 'reason', 'WORKOUT_REASONING_FAILED'],
    ['nutritionStrategy', 'build', 'NUTRITION_STRATEGY_FAILED'],
    ['workoutStrategy', 'build', 'WORKOUT_STRATEGY_FAILED'],
    ['nutritionAdapter', 'adapt', 'ADAPTER_FAILED'],
    ['comparator', 'compare', 'COMPARATOR_FAILED'],
  ] as const)(
    'isolates a %s failure and records only structured failure metadata',
    async (dependency, method, failureCode) => {
      const subject = createSubject();
      const target = subject.dependencies[dependency] as unknown as Record<
        string,
        jest.Mock
      >;
      target[method].mockImplementation(() => {
        throw new Error('isolated');
      });

      const result = await subject.service.execute(input());

      expect(result.status).toBe('FAILED');
      if (result.status === 'FAILED') {
        expect(result.failure.failureCode).toBe(failureCode);
        expect(Object.isFrozen(result.failure)).toBe(true);
      }
      expect('artifacts' in result).toBe(false);
      expect(subject.dependencies.audit.recordFailed).toHaveBeenCalledTimes(1);
    },
  );

  it('does not turn an audit persistence failure into a pipeline failure', async () => {
    const subject = createSubject();
    jest
      .mocked(subject.dependencies.audit.recordCompleted)
      .mockRejectedValue(new Error('audit unavailable'));

    const result = await subject.service.execute(input());

    expect(result.status).toBe('COMPLETED');
    if (result.status === 'COMPLETED')
      expect(result.auditPersisted).toBe(false);
  });

  it('is not registered in production modules or invoked by protected services', () => {
    const protectedSources = [
      'responses/response.module.ts',
      'responses/response-builder.service.ts',
      'automation/automation.module.ts',
      'automation/coach-command.service.ts',
      'diet/diet.module.ts',
      'workout/workout.module.ts',
    ].map((path) => readFileSync(join(__dirname, '..', path), 'utf8'));

    for (const source of protectedSources) {
      expect(source).not.toContain('UnifiedShadowDecisionPipelineService');
    }
  });
});
