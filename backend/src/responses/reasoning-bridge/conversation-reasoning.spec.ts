import { performance } from 'node:perf_hooks';
import type { ConversationGoalDecision } from '../../context/conversation-goal-planner.contract';
import type { LongitudinalResponseContext } from '../../longitudinal/interfaces/longitudinal.interface';
import type { NutritionReasoningResult } from '../../nutrition-reasoning/nutrition-reasoning.contract';
import type { WorkoutReasoningResult } from '../../workout-reasoning/workout-reasoning.contract';
import { ConversationReasoningBridgeService } from './conversation-reasoning-bridge.service';

function nutrition(
  overrides: Partial<NutritionReasoningResult> = {},
): NutritionReasoningResult {
  return {
    prioritizedObjectives: [
      {
        objective: 'PERFORMANCE',
        priority: 'HIGH',
        primary: true,
        sourcePackageIds: [],
        reasonCodes: ['GOAL_ALIGNMENT'],
      },
    ],
    packageDecisions: [],
    activeFactors: [],
    discardedFactors: [],
    resolvedConflicts: [],
    appliedRestrictions: [],
    selectedStrategies: [
      {
        strategy: 'SPORTS_FUELING',
        priority: 'HIGH',
        sourcePackageIds: [],
        reasonCodes: ['SPORTS_CONTEXT'],
      },
      {
        strategy: 'HYDRATION_SUPPORT',
        priority: 'HIGH',
        sourcePackageIds: [],
        reasonCodes: ['INADEQUATE_HYDRATION'],
      },
    ],
    prohibitedStrategies: [],
    interventionIntensity: 'MODERATE',
    personalizationLevel: 'HIGH',
    recommendedComplexity: 'MODERATE',
    priorities: {
      adherence: 'HIGH',
      performance: 'HIGH',
      recovery: 'MEDIUM',
      education: 'LOW',
      practicality: 'MEDIUM',
      economy: 'LOW',
      satiety: 'LOW',
      behavior: 'MEDIUM',
    },
    metadata: {
      schemaVersion: 1,
      strategyVersion: '2026.08.1',
      knowledgeCatalogVersion: '2026.08.1',
      sourcePackageIds: [],
      conversationGoal: 'GENERATE_DIET_PLAN',
      artifactType: 'WEEKLY_PLAN',
      deterministic: true,
      safetyRestricted: false,
    },
    ...overrides,
  };
}

function workout(
  overrides: Partial<WorkoutReasoningResult> = {},
): WorkoutReasoningResult {
  return {
    primaryObjective: 'STRENGTH',
    secondaryObjectives: ['ADHERENCE'],
    modality: {
      requested: 'GYM_STRENGTH',
      profile: 'GYM_STRENGTH',
      resolved: 'GYM_STRENGTH',
      status: 'CONFIRMED',
      requiresConfirmation: false,
    },
    knowledgeDecisions: [],
    activeFactors: [],
    discardedFactors: [],
    resolvedConflicts: [],
    appliedConstraints: [],
    selectedStrategies: [
      {
        strategy: 'TECHNIQUE_PRIORITY',
        priority: 'HIGH',
        sourcePackageIds: [],
        rationaleCodes: ['KNOWLEDGE_PRIORITY'],
      },
      {
        strategy: 'CONSERVATIVE_PROGRESSION',
        priority: 'HIGH',
        sourcePackageIds: [],
        rationaleCodes: ['PROGRESSION_ALLOWED'],
      },
    ],
    prohibitedStrategies: [],
    interventionIntensity: 'MODERATE_HIGH',
    authorizedComplexity: 'STANDARD',
    progressionDecision: 'PROGRESS',
    priorities: {
      safety: 'HIGH',
      technique: 'HIGH',
      adherence: 'MEDIUM',
      motivation: 'LOW',
      education: 'MEDIUM',
      strength: 'HIGH',
      hypertrophy: 'LOW',
      endurance: 'LOW',
      conditioning: 'LOW',
      mobility: 'LOW',
      recovery: 'MEDIUM',
      progression: 'HIGH',
      practicality: 'MEDIUM',
      equipment: 'LOW',
      environment: 'LOW',
    },
    rationaleCodes: ['OBJECTIVE_ALIGNMENT'],
    metadata: {
      schemaVersion: 1,
      strategyVersion: '2026.07.1',
      knowledgeSchemaVersion: 1,
      knowledgeCatalogVersion: '2026.07.1',
      sourcePackageIds: [],
      conversationGoal: 'GENERATE_WORKOUT_PLAN',
      artifactType: 'WEEKLY_PLAN',
      requestedModality: 'GYM_STRENGTH',
      experience: 'INTERMEDIATE',
      deterministic: true,
      safetyRestricted: false,
    },
    ...overrides,
  };
}

function planner(
  selectedProfileField: ConversationGoalDecision['selectedProfileField'] = null,
): ConversationGoalDecision {
  return {
    recognizedIntent: selectedProfileField
      ? 'CONFIRMATION_REQUIRED'
      : 'COMBINED_PLAN_REQUEST',
    goal: selectedProfileField
      ? 'ASK_PROFILE_INFORMATION'
      : 'GENERATE_COMBINED_PLANS',
    reason: selectedProfileField
      ? 'PROFILE_INFORMATION_REQUIRED'
      : 'COMBINED_PROFILE_READY',
    targetPlan: selectedProfileField ? 'DIET' : 'BOTH',
    profileCompletionState: selectedProfileField ? 'PARTIAL' : 'COMPLETE',
    canExecute: !selectedProfileField,
    confidence: 'HIGH',
    selectedProfileField,
    metPreconditions: [],
    missingPreconditions: [],
    pendingDependencies: [],
  };
}

function longitudinalContext(): LongitudinalResponseContext {
  return {
    profile: { historySize: 12, adherenceScore: 82, consistencyScore: 78 },
    preferences: [],
    evolution: {
      overallDirection: 'IMPROVING',
      scores: {
        quality: 80,
        hydration: 72,
        vegetables: 68,
        ultraProcessed: 75,
        sugar: 76,
        protein: 84,
      },
    },
    relapse: null,
    goalProgression: null,
    coachAdaptation: {
      mode: 'PERFORMANCE',
      reason: 'INTERNAL_REASON_SHOULD_NOT_BE_EXPOSED',
    },
    memories: [],
    monthlyReview: null,
  };
}

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(assertDeepFrozen);
}

describe('ConversationReasoningBridgeService', () => {
  const bridge = new ConversationReasoningBridgeService();

  it('representa ausência de reasoning sem fabricar evidência', () => {
    expect(bridge.build({})).toEqual({
      evidence: null,
      availability: {
        planner: false,
        nutrition: false,
        workout: false,
        longitudinal: false,
      },
    });
  });

  it('transforma nutrição simples em prioridades, estratégias e ensino', () => {
    const result = bridge.build({ nutrition: nutrition() });

    expect(result.evidence?.summary.decision).toBe('apoiar desempenho');
    expect(result.evidence?.priorities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ topic: 'aderência', importance: 'alta' }),
        expect.objectContaining({ topic: 'desempenho', importance: 'alta' }),
      ]),
    );
    expect(result.evidence?.strategies.map((item) => item.name)).toEqual(
      expect.arrayContaining(['energia para o treino', 'suporte à hidratação']),
    );
    expect(
      result.evidence?.teachingOpportunities.map((item) => item.topic),
    ).toEqual(expect.arrayContaining(['energia para o treino', 'hidratação']));
  });

  it('preserva alta aderência e recuperação como decisões semânticas distintas', () => {
    const result = bridge.build({
      nutrition: nutrition({
        prioritizedObjectives: [
          {
            objective: 'RECOVERY',
            priority: 'HIGH',
            primary: true,
            sourcePackageIds: [],
            reasonCodes: ['GOAL_ALIGNMENT'],
          },
        ],
        selectedStrategies: [
          {
            strategy: 'RECOVERY_SUPPORT',
            priority: 'HIGH',
            sourcePackageIds: [],
            reasonCodes: ['SPORTS_CONTEXT'],
          },
        ],
        priorities: {
          ...nutrition().priorities,
          adherence: 'HIGH',
          recovery: 'HIGH',
        },
      }),
    });

    expect(result.evidence?.summary.decision).toBe('favorecer recuperação');
    expect(result.evidence?.priorities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ topic: 'aderência', importance: 'alta' }),
        expect.objectContaining({ topic: 'recuperação', importance: 'alta' }),
      ]),
    );
  });

  it('materializa baixa aderência, múltiplas restrições e conflito sem códigos internos', () => {
    const source = nutrition({
      resolvedConflicts: [
        {
          conflict: 'WEIGHT_LOSS_EATING_OUT_LOW_ADHERENCE',
          packageIds: [],
          elevatedStrategies: ['BEHAVIOR_ADHERENCE'],
          reducedStrategies: ['EXTENSIVE_VARIETY'],
          prohibitedStrategies: ['AGGRESSIVE_RESTRICTION'],
          reasonCodes: ['CONFLICT_RESOLUTION'],
        },
      ],
      appliedRestrictions: [
        {
          code: 'internal-restriction-one',
          enforcement: 'REQUIRE',
          sourcePackageIds: [],
        },
        {
          code: 'internal-restriction-two',
          enforcement: 'CAUTION',
          sourcePackageIds: [],
        },
      ],
      priorities: {
        ...nutrition().priorities,
        adherence: 'CRITICAL',
      },
      metadata: { ...nutrition().metadata, safetyRestricted: true },
    });
    const result = bridge.build({ nutrition: source });
    const serialized = JSON.stringify(result.evidence);

    expect(result.evidence?.tradeoffs[0]).toEqual(
      expect.objectContaining({ preferred: 'uma escolha simples e repetível' }),
    );
    expect(result.evidence?.restrictions).toHaveLength(2);
    expect(result.evidence?.safety.requiresCaution).toBe(true);
    expect(serialized).not.toMatch(
      /WEIGHT_LOSS_EATING_OUT_LOW_ADHERENCE|BEHAVIOR_ADHERENCE|internal-restriction|reasonCode|packageId|strategyId/u,
    );
  });

  it('transforma reasoning de treino sem reconstruir decisões', () => {
    const result = bridge.build({ workout: workout() });

    expect(result.evidence?.summary).toEqual(
      expect.objectContaining({
        decision: 'desenvolver força',
        expectedBenefit: 'promover evolução gradual',
      }),
    );
    expect(result.evidence?.strategies.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        'técnica antes da intensidade',
        'progressão conservadora',
      ]),
    );
  });

  it('combina Planner, Nutrition e Workout em uma única evidência sem duplicação', () => {
    const result = bridge.build({
      planner: planner(),
      nutrition: nutrition(),
      workout: workout(),
    });

    expect(result.availability).toEqual({
      planner: true,
      nutrition: true,
      workout: true,
      longitudinal: false,
    });
    expect(result.evidence?.summary.goal).toBe(
      'criar planos de alimentação e treino',
    );
    expect(
      new Set(result.evidence?.strategies.map((item) => item.name)).size,
    ).toBe(result.evidence?.strategies.length);
  });

  it('resume continuidade, progresso e aderência longitudinal', () => {
    const result = bridge.build({ longitudinalContext: longitudinalContext() });

    expect(result.evidence?.longitudinal).toEqual({
      continuity: 'A continuidade pode conectar o próximo passo ao desempenho.',
      progress: 'A evolução recente está em melhora.',
      adherence: 'A aderência observada está consistente.',
      repetitionRisk: false,
    });
  });

  it('sugere pergunta somente quando o Planner seleciona informação necessária', () => {
    const result = bridge.build({ planner: planner('TRAINING_TIME') });

    expect(result.evidence?.suggestedQuestions).toEqual([
      {
        question: 'Em qual horário você costuma treinar?',
        purpose: 'alinhar alimentação, energia e recuperação ao treino',
      },
    ]);
    expect(
      bridge.build({ planner: planner() }).evidence?.suggestedQuestions,
    ).toEqual([]);
  });

  it('não repete oportunidade de ensino já apresentada', () => {
    const result = bridge.build({
      nutrition: nutrition(),
      previouslyTaughtTopics: ['hidratação', 'energia para o treino'],
    });

    expect(result.evidence?.teachingOpportunities).toEqual([]);
  });

  it('é determinístico, profundamente imutável e permanece abaixo de 5 ms', () => {
    const input = {
      planner: planner(),
      nutrition: nutrition(),
      workout: workout(),
      longitudinalContext: longitudinalContext(),
    };
    const first = bridge.build(input);
    const second = bridge.build(input);
    expect(second).toEqual(first);
    assertDeepFrozen(first);

    const iterations = 1_000;
    const startedAt = performance.now();
    for (let index = 0; index < iterations; index += 1) bridge.build(input);
    expect((performance.now() - startedAt) / iterations).toBeLessThan(5);
  });
});
