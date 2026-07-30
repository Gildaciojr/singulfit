import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShadowEvaluationReport } from './shadow-evaluation.contract';
import { ShadowEvaluationPlatform } from './shadow-evaluation-platform';
import {
  CompletedShadowObservationEmitterInput,
  ShadowObservationEmitter,
  ShadowObservationEmitterInput,
} from './shadow-observation-emitter';
import type { ShadowObservationEnvelope } from './shadow-observation-envelope.contract';

describe('ShadowObservationEmitter', () => {
  function fixture<T>(value: unknown): T {
    return value as T;
  }

  function completedInput(): CompletedShadowObservationEmitterInput {
    return fixture<CompletedShadowObservationEmitterInput>({
      runId: 'shadow-run-1',
      snapshot: {
        identity: {
          userId: 'forbidden-user-id',
          displayName: {
            status: 'KNOWN',
            value: 'forbidden-display-name',
          },
        },
        conversation: {
          memorySummaries: ['forbidden-user-message'],
        },
        referenceDate: '2026-07-17T12:00:00.000Z',
        completion: {
          overall: 'COMPLETE',
          sections: [
            {
              section: 'GENERAL',
              state: 'COMPLETE',
              ready: true,
              requiredFields: ['DISPLAY_NAME', 'PRIMARY_GOAL'],
              availableFields: ['DISPLAY_NAME', 'PRIMARY_GOAL'],
              missingFields: [],
              confirmationRequiredFields: [],
            },
          ],
        },
      },
      artifacts: {
        adaptiveDecision: {
          intent: 'COMBINED_PLAN_REQUEST',
          shouldAsk: false,
          orderedCandidates: [
            {
              field: 'AGE',
              state: 'READY_TO_ASK',
              knowledgeStatus: 'UNKNOWN',
              reason: 'forbidden-candidate-text',
            },
          ],
        },
        plannerDecision: {
          recognizedIntent: 'COMBINED_PLAN_REQUEST',
          goal: 'GENERATE_COMBINED_PLANS',
          targetPlan: 'BOTH',
          canExecute: true,
          reason: 'forbidden-planner-text',
        },
        longitudinalDecision: {
          currentState: 'STABLE',
          decision: 'KEEP_PLAN',
          priorities: {
            nutrition: 'MEDIUM',
            training: 'MEDIUM',
            behavioral: 'LOW',
            safety: 'LOW',
          },
          risks: [
            {
              code: 'INSUFFICIENT_INFORMATION',
              severity: 'LOW',
              domain: 'GENERAL',
            },
          ],
          interventionIntensity: 'LOW',
          rationaleCodes: ['INSUFFICIENT_INFORMATION'],
          metadata: {
            policyVersion: '2026.07.1',
            deterministic: true,
            referenceDate: '2026-07-17T12:00:00.000Z',
          },
        },
        nutritionReasoning: {
          packageDecisions: [
            {
              packageId: 'weight-loss',
              disposition: 'REQUIRED',
              originalPriority: 'HIGH',
              resolvedPriority: 'HIGH',
              reasonCodes: [],
            },
          ],
          resolvedConflicts: [
            {
              conflict: 'ADHERENCE_OVER_COMPLEXITY',
              packageIds: ['weight-loss'],
              elevatedStrategies: [],
              reducedStrategies: [],
              prohibitedStrategies: [],
              reasonCodes: [],
            },
          ],
          selectedStrategies: [
            {
              strategy: 'ENERGY_BALANCE',
              priority: 'HIGH',
              sourcePackageIds: ['weight-loss'],
              reasonCodes: [],
            },
          ],
          prohibitedStrategies: [
            {
              strategy: 'AGGRESSIVE_RESTRICTION',
              sourcePackageIds: ['weight-loss'],
              reasonCodes: [],
            },
          ],
          interventionIntensity: 'MODERATE',
          personalizationLevel: 'CONTEXTUAL',
          recommendedComplexity: 'MODERATE',
          priorities: {
            adherence: 'HIGH',
            performance: 'MEDIUM',
            recovery: 'MEDIUM',
            education: 'LOW',
            practicality: 'HIGH',
            economy: 'LOW',
            satiety: 'HIGH',
            behavior: 'MEDIUM',
          },
          metadata: {
            strategyVersion: '2026.07.1',
            deterministic: true,
            safetyRestricted: false,
            prompt: 'forbidden-prompt',
          },
        },
        workoutReasoning: {
          primaryObjective: 'HYPERTROPHY',
          modality: {
            requested: 'STRENGTH_TRAINING',
            profile: 'STRENGTH_TRAINING',
            resolved: 'STRENGTH_TRAINING',
            status: 'CONFIRMED',
            requiresConfirmation: false,
          },
          knowledgeDecisions: [
            {
              packageId: 'hypertrophy',
              disposition: 'REQUIRED',
              originalPriority: 'HIGH',
              resolvedPriority: 'HIGH',
              rationaleCodes: [],
            },
          ],
          resolvedConflicts: [
            {
              conflict: 'LOW_ADHERENCE_COMPLEX_PLAN',
              packageIds: ['hypertrophy'],
              elevatedStrategies: [],
              reducedStrategies: [],
              prohibitedStrategies: [],
              rationaleCodes: [],
            },
          ],
          selectedStrategies: [
            {
              strategy: 'ADHERENCE_FIRST',
              priority: 'HIGH',
              sourcePackageIds: ['hypertrophy'],
              rationaleCodes: [],
            },
          ],
          prohibitedStrategies: [
            {
              prohibition: 'ADVANCED_MOVEMENTS_FOR_BEGINNER',
              sourcePackageIds: ['hypertrophy'],
              rationaleCodes: [],
            },
          ],
          interventionIntensity: 'MODERATE',
          authorizedComplexity: 'STANDARD',
          progressionDecision: 'MAINTAIN',
          priorities: {
            safety: 'CRITICAL',
            adherence: 'HIGH',
            motivation: 'MEDIUM',
            education: 'LOW',
            strength: 'HIGH',
            hypertrophy: 'HIGH',
            endurance: 'LOW',
            conditioning: 'MEDIUM',
            mobility: 'LOW',
            recovery: 'MEDIUM',
            progression: 'MEDIUM',
            practicality: 'HIGH',
            equipment: 'MEDIUM',
            environment: 'MEDIUM',
          },
          metadata: {
            strategyVersion: '2026.07.1',
            deterministic: true,
            safetyRestricted: false,
            rawContext: 'forbidden-raw-context',
          },
        },
        nutritionLegacyStrategy: {
          excludedFoods: ['forbidden-free-text-food'],
        },
        workoutLegacyStrategy: {
          objective: { status: 'CONFIRMED', value: 'HYPERTROPHY' },
          appliedConstraints: [{ label: 'forbidden-limitation-text' }],
        },
        nutritionShadowStrategy: {
          adapterVersion: '2026.07.1',
          artifactType: 'DIET_PLAN',
          interventionIntensity: 'MODERATE',
          complexity: 'MODERATE',
          personalization: 'CONTEXTUAL',
          variationPolicy: 'DAILY',
          detailLevel: 'STANDARD',
          trainingAware: true,
          safetyRestricted: false,
          restrictionCodes: ['ALLERGY'],
          selectedStrategies: ['ENERGY_BALANCE'],
          prohibitedStrategies: ['AGGRESSIVE_RESTRICTION'],
        },
        workoutShadowStrategy: {
          adapterVersion: '2026.07.1',
          artifactType: 'WORKOUT_PLAN',
          modality: 'STRENGTH_TRAINING',
          objective: 'HYPERTROPHY',
          interventionIntensity: 'MODERATE',
          complexity: 'STANDARD',
          personalization: 'CONTEXTUAL',
          progression: 'MAINTAIN',
          requiredBlocks: ['WARM_UP', 'MAIN'],
          maximumActivitiesPerSession: 8,
          technicalMovementsAllowed: true,
          safetyRestricted: false,
          constraintCodes: ['KNEE_LOAD'],
          selectedStrategies: ['ADHERENCE_FIRST'],
          prohibitedStrategies: ['ADVANCED_MOVEMENTS_FOR_BEGINNER'],
        },
      },
      pipelineResult: {
        status: 'COMPLETED',
        comparison: {
          comparatorVersion: '2026.07.1',
          nutrition: {
            category: 'COMPATIBLE',
            exact: false,
            differences: [
              {
                domain: 'NUTRITION',
                dimension: 'COMPLEXITY',
                legacyValue: 'forbidden-legacy-value',
                shadowValue: 'forbidden-shadow-value',
              },
            ],
          },
          workout: {
            category: 'EXACT_MATCH',
            exact: true,
            differences: [],
          },
          longitudinal: {
            category: 'EXACT_MATCH',
            exact: true,
            differences: [],
          },
          overallCategory: 'COMPATIBLE',
        },
        auditMetadata: {
          status: 'COMPLETED',
          plannerGoal: 'GENERATE_COMBINED_PLANS',
          collectorShouldAsk: false,
          overallCategory: 'COMPATIBLE',
          nutritionCategory: 'COMPATIBLE',
          workoutCategory: 'EXACT_MATCH',
          longitudinalCategory: 'EXACT_MATCH',
          nutritionIntensity: 'MODERATE',
          nutritionComplexity: 'MODERATE',
          workoutIntensity: 'MODERATE',
          workoutComplexity: 'STANDARD',
          workoutProgression: 'MAINTAIN',
          longitudinalDecision: 'KEEP_PLAN',
          differenceDimensions: ['COMPLEXITY'],
          differences: [
            {
              domain: 'NUTRITION',
              dimension: 'COMPLEXITY',
              legacyValue: 'forbidden-audit-legacy-value',
              shadowValue: 'forbidden-audit-shadow-value',
            },
          ],
          nutritionStrategyCodes: ['ENERGY_BALANCE'],
          workoutStrategyCodes: ['ADHERENCE_FIRST'],
          latency: {
            collectorMs: 1,
            plannerMs: 2,
            longitudinalMs: 3,
            nutritionReasoningMs: 4,
            workoutReasoningMs: 5,
            nutritionStrategyMs: 6,
            workoutStrategyMs: 7,
            adaptersMs: 8,
            comparatorMs: 9,
            totalMs: 45,
          },
          versions: {
            adapter: '2026.07.1',
            comparator: '2026.07.1',
            pipeline: '2026.07.1',
            nutritionReasoning: '2026.07.1',
            workoutReasoning: '2026.07.1',
            longitudinalPolicy: '2026.07.1',
          },
        },
        auditPersisted: false,
      },
    });
  }

  it('emits a complete sanitized envelope and discards the report', () => {
    const evaluate = jest.fn<ShadowEvaluationPlatform['evaluate']>();
    evaluate.mockReturnValue(fixture<ShadowEvaluationReport>({ secret: true }));
    const emitter = new ShadowObservationEmitter({ evaluate });

    const result = emitter.emit(completedInput());

    expect(result).toEqual({ status: 'SUCCESS' });
    expect(Object.keys(result)).toEqual(['status']);
    expect(evaluate).toHaveBeenCalledTimes(1);
    const envelope = evaluate.mock.calls[0][0];
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.pipelineResult.comparison.nutrition?.differences).toEqual([
      { domain: 'NUTRITION', dimension: 'COMPLEXITY' },
    ]);
  });

  it('supports partial observations and absent optional domains', () => {
    const input = completedInput();
    const partial = fixture<CompletedShadowObservationEmitterInput>({
      ...input,
      snapshot: {
        ...input.snapshot,
        completion: { overall: 'PARTIAL', sections: [] },
      },
      artifacts: {
        ...input.artifacts,
        nutritionReasoning: null,
        workoutReasoning: null,
        nutritionLegacyStrategy: null,
        workoutLegacyStrategy: null,
        nutritionShadowStrategy: null,
        workoutShadowStrategy: null,
      },
      pipelineResult: {
        ...input.pipelineResult,
        comparison: {
          ...input.pipelineResult.comparison,
          nutrition: null,
          workout: null,
        },
        auditMetadata: {
          ...input.pipelineResult.auditMetadata,
          nutritionCategory: null,
          workoutCategory: null,
          nutritionIntensity: null,
          nutritionComplexity: null,
          workoutIntensity: null,
          workoutComplexity: null,
          workoutProgression: null,
          latency: {
            ...input.pipelineResult.auditMetadata.latency,
            nutritionReasoningMs: null,
            workoutReasoningMs: null,
            nutritionStrategyMs: null,
            workoutStrategyMs: null,
          },
        },
      },
    });
    const platform = new ShadowEvaluationPlatform();
    const emitter = new ShadowObservationEmitter(platform);

    expect(emitter.emit(partial)).toEqual({ status: 'SUCCESS' });
    const envelope = emitter.createEnvelope(partial);
    expect(envelope.snapshot.completion.overall).toBe('PARTIAL');
    expect(envelope.artifacts.nutritionReasoning).toBeNull();
    expect(envelope.artifacts.workoutReasoning).toBeNull();
  });

  it.each([
    { status: 'SKIPPED', reason: 'MODE_NOT_SHADOW' },
    {
      status: 'FAILED',
      failure: {
        status: 'FAILED',
        failureCode: 'COMPARATOR_FAILED',
        pipelineVersion: '2026.07.1',
        totalMs: 1,
      },
      auditPersisted: false,
    },
  ] as const)('skips non-completed pipeline result %#', (pipelineResult) => {
    const evaluate = jest.fn<ShadowEvaluationPlatform['evaluate']>();
    const emitter = new ShadowObservationEmitter({ evaluate });
    const input = fixture<ShadowObservationEmitterInput>({
      ...completedInput(),
      pipelineResult,
    });

    expect(emitter.emit(input)).toEqual({
      status: 'SKIPPED',
      reason: 'PIPELINE_NOT_COMPLETED',
    });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('isolates evaluation platform failures without mutating input', () => {
    const evaluate = jest.fn<ShadowEvaluationPlatform['evaluate']>();
    evaluate.mockImplementation(() => {
      throw new Error('evaluation unavailable');
    });
    const emitter = new ShadowObservationEmitter({ evaluate });
    const input = completedInput();
    const before = JSON.stringify(input);

    expect(emitter.emit(input)).toEqual({
      status: 'FAILED',
      reason: 'EVALUATION_FAILED',
    });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('produces deterministic, deeply frozen and serializable envelopes', () => {
    const emitter = new ShadowObservationEmitter(
      new ShadowEvaluationPlatform(),
    );
    const input = completedInput();
    const first = emitter.createEnvelope(input);
    const second = emitter.createEnvelope(input);

    expect(first).toEqual(second);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expectDeepFrozen(first);
    expect(
      Object.isFrozen(first.artifacts.nutritionReasoning?.priorities),
    ).toBe(true);
  });

  it('excludes sensitive, textual, raw and operational values', () => {
    const emitter = new ShadowObservationEmitter(
      new ShadowEvaluationPlatform(),
    );
    const serialized = JSON.stringify(emitter.createEnvelope(completedInput()));
    const forbidden = [
      'forbidden-user-id',
      'forbidden-display-name',
      'forbidden-user-message',
      'forbidden-candidate-text',
      'forbidden-planner-text',
      'forbidden-prompt',
      'forbidden-raw-context',
      'forbidden-free-text-food',
      'forbidden-limitation-text',
      'forbidden-legacy-value',
      'forbidden-shadow-value',
      'forbidden-audit-legacy-value',
      'forbidden-audit-shadow-value',
    ];

    for (const value of forbidden) expect(serialized).not.toContain(value);
    expect(serialized).not.toContain('userId');
    expect(serialized).not.toContain('prompt');
    expect(serialized).not.toContain('rawContext');
    expect(serialized).not.toContain('legacyValue');
    expect(serialized).not.toContain('shadowValue');
  });

  it('is not registered in productive modules or flows', () => {
    const sourceRoot = join(__dirname, '..');
    const protectedFiles = [
      'responses/response.module.ts',
      'responses/response-builder.service.ts',
      'automation/coach-command.service.ts',
      'unified-shadow-decision/unified-shadow-decision-pipeline.service.ts',
    ];

    for (const file of protectedFiles) {
      expect(readFileSync(join(sourceRoot, file), 'utf8')).not.toContain(
        'ShadowObservationEmitter',
      );
    }
  });
});

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeepFrozen(nested);
}
