import type { CompositionPlan } from './conversation-composition.contract';
import type { DecisionPlan } from './conversation-decision.contract';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';
import { NutritionConversationFlowPlanner } from './nutrition-conversation-flow-planner';
import { NutritionConversationPersonalizationEngine } from './nutrition-conversation-personalization.engine';
import { NutritionConversationStylePlanner } from './nutrition-conversation-style-planner';

interface ContextOptions {
  readonly goal?: NutritionConversationContext['userContext']['goal'];
  readonly activityLevel?: string;
  readonly restrictions?: readonly string[];
  readonly stage?: NutritionConversationContext['communication']['stageOfChange'];
  readonly fatigue?: number;
  readonly repeatedTheme?: number;
  readonly repeatedPhrase?: number;
  readonly specificQuestion?: boolean;
  readonly detailRequest?: boolean;
  readonly followUp?: boolean;
  readonly memory?: boolean;
  readonly longitudinal?: boolean;
  readonly shortMessages?: boolean;
  readonly preferredLength?: number;
  readonly shouldAskQuestion?: boolean;
  readonly positiveEvidence?: boolean;
}

function context(options: ContextOptions = {}): NutritionConversationContext {
  return {
    metadata: { mealAnalysisId: 'analysis-id' },
    facts: {
      mealCategory: 'LUNCH',
      foods: [{ name: 'Arroz', estimatedGrams: 120 }],
      totalCalories: 420,
      totalProtein: 25,
      totalCarbs: 52,
      totalFat: 10,
      qualityScore: 78,
      confidence: 0.92,
    },
    policies: { requiresEstimateQualification: false },
    userContext: {
      goal: options.goal ?? 'MAINTENANCE',
      activityLevel: options.activityLevel ?? 'MODERATE',
      relevantRestrictions: (options.restrictions ?? []).map((description) => ({
        description,
      })),
      relevantAllergies: [],
      preferredLanguage: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      ...(options.memory
        ? { memory: { summary: 'Ajuste anterior útil' } }
        : {}),
      recentMeals: [],
      ...(options.longitudinal
        ? {
            longitudinalSignal: {
              kind: 'NUTRITION_EVOLUTION',
              direction: 'IMPROVING',
            },
          }
        : {}),
    },
    direction: {
      supportingEvidence: {
        positiveFactors: options.positiveEvidence ? ['Boa distribuição'] : [],
        limitingFactors: [],
      },
    },
    recognition: { signals: [] },
    emotional: { signals: [] },
    episodicMemory: { episodes: [] },
    dialogue: {
      interactionIntent: options.followUp ? 'FOLLOW_UP' : 'MEAL_ANALYSIS',
      explicitDetailRequest: options.detailRequest ?? false,
      specificQuestion: options.specificQuestion ?? false,
      clarificationRequired: false,
      previousCommitmentAvailable: options.memory ?? false,
    },
    communication: {
      communicationStyle: 'BALANCED',
      coachingStyle: 'MOTIVATIONAL',
      tone: 'MODERATE',
      motivationFocus:
        options.goal === 'MUSCLE_GAIN' ? 'PERFORMANCE' : 'HEALTH',
      prefersShortMessages: options.shortMessages ?? false,
      preferredMessageLength: options.preferredLength ?? 600,
      idealEmojiCount: 0,
      fatigue: {
        score: options.fatigue ?? 20,
        repeatedThemeScore: options.repeatedTheme ?? 0,
        repeatedPhraseScore: options.repeatedPhrase ?? 0,
      },
      stageOfChange: options.stage ?? 'ACTION',
      preferredTopics: [],
      ignoredTopics: [],
      shouldAskQuestion: options.shouldAskQuestion ?? false,
    },
  };
}

function composition(
  overrides: Partial<CompositionPlan> = {},
): CompositionPlan {
  return {
    id: 'composition-id',
    decisionPlanId: 'decision-plan-id',
    blocks: [],
    dialogueProfile: 'ACKNOWLEDGE_ONLY',
    centralIntent: 'RECOGNIZE',
    profileBudgets: {
      maximumPerceptibleDecisions: 3,
      maximumFactCount: 7,
      maximumBlockCount: 4,
      maximumParagraphCount: 3,
      maximumQuestions: 1,
      maximumActions: 1,
      maximumEmojiCount: 0,
      maximumLength: 600,
    },
    closingRequirement: 'OPTIONAL',
    depth: 'BRIEF',
    density: 'LOW',
    rhythm: 'WARM',
    presentation: 'PROSE',
    paragraphCount: 2,
    maximumLength: 600,
    emojiAllowed: false,
    maximumEmojiCount: 0,
    ...overrides,
  };
}

function decisionPlan(profile: DecisionPlan['dialogueProfile']): DecisionPlan {
  const centralIntent: Record<
    DecisionPlan['dialogueProfile'],
    DecisionPlan['centralIntent']
  > = {
    ACKNOWLEDGE_ONLY: 'RECOGNIZE',
    ACKNOWLEDGE_AND_ADJUST: 'ADJUST',
    REFLECT_AND_ASK: 'CLARIFY',
    TEACH_BRIEFLY: 'TEACH',
    RECOVERY: 'RECOVER',
    CELEBRATE: 'CELEBRATE',
    DETAILED_ANALYSIS: 'ANALYZE',
    CLARIFY_BEFORE_ANALYSIS: 'CLARIFY',
    REASSURE_AND_SIMPLIFY: 'REASSURE',
    CONTINUITY_CHECK: 'FOLLOW_UP',
  };
  return {
    id: 'decision-plan-id',
    primaryDecisionId: 'nutrition.respond-to-meal',
    dialogueProfile: profile,
    centralIntent: centralIntent[profile],
    selectedDecisions: [
      {
        candidateId: 'nutrition.respond-to-meal',
        code: 'RESPOND',
        intrinsicPriority: 'P1',
        order: 0,
        factIds: ['facts.foods'],
        rationaleCodes: ['PRIMARY'],
      },
    ],
    suppressedDecisions: [],
    mandatoryDecisionIds: [],
    prohibitedDecisionCodes: [],
    maximumCommunicativeDecisions: 3,
    maximumQuestions: 1,
    maximumActions: 1,
  };
}

describe('Nutrition conversation deterministic planning', () => {
  const personalizationEngine =
    new NutritionConversationPersonalizationEngine();
  const stylePlanner = new NutritionConversationStylePlanner();
  const flowPlanner = new NutritionConversationFlowPlanner();

  it('personaliza performance e mantém resultado determinístico', () => {
    const source = context({ goal: 'MUSCLE_GAIN', activityLevel: 'ATHLETE' });
    const first = personalizationEngine.personalize(source);
    const second = personalizationEngine.personalize(source);

    expect(second).toEqual(first);
    expect(first.performanceOriented).toBe(true);
    expect(first.objectivity).toBe('MEDIUM');
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('prioriza safety, precisão e ausência de pergunta para restrições', () => {
    const source = context({
      restrictions: ['Doença celíaca'],
      shouldAskQuestion: true,
      positiveEvidence: true,
    });
    const personalization = personalizationEngine.personalize(source);
    const style = stylePlanner.plan(source, composition(), ['RESPOND_TO_MEAL']);
    const flow = flowPlanner.plan(
      source,
      decisionPlan('ACKNOWLEDGE_AND_ADJUST'),
    );

    expect(personalization).toEqual(
      expect.objectContaining({
        safetySensitive: true,
        formality: 'PROFESSIONAL_PRECISE',
        questionBudget: 0,
      }),
    );
    expect(style.humor).toBe('PROHIBITED');
    expect(flow.pattern).toBe('SAFETY_FIRST_GUIDANCE');
  });

  it('reduz explicação, motivação e repetição quando existe fadiga conversacional', () => {
    const source = context({
      fatigue: 78,
      repeatedTheme: 80,
      repeatedPhrase: 75,
      shouldAskQuestion: true,
    });
    const personalization = personalizationEngine.personalize(source);
    const style = stylePlanner.plan(source, composition(), ['RESPOND_TO_MEAL']);
    const flow = flowPlanner.plan(source, decisionPlan('TEACH_BRIEFLY'));

    expect(personalization).toEqual(
      expect.objectContaining({
        cognitiveLoad: 'LOW',
        explanationLevel: 'ANSWER_ONLY',
        educationalFocus: 'LOW',
        questionBudget: 0,
      }),
    );
    expect(style.pacing).toBe('COMPACT');
    expect(flow.suppressRepeatedEducation).toBe(true);
    expect(flow.shouldTeach).toBe(false);
  });

  it('aprofundamento explícito produz fluxo progressivo e explicativo', () => {
    const source = context({ detailRequest: true, preferredLength: 1_000 });
    const detailedComposition = composition({
      dialogueProfile: 'DETAILED_ANALYSIS',
      centralIntent: 'ANALYZE',
      depth: 'DEEP',
      rhythm: 'EXPLANATORY',
    });
    const personalization = personalizationEngine.personalize(source);
    const style = stylePlanner.plan(source, detailedComposition, [
      'DETAIL_ANALYSIS',
    ]);
    const flow = flowPlanner.plan(source, decisionPlan('DETAILED_ANALYSIS'));

    expect(personalization.explanationLevel).toBe('DETAILED');
    expect(style.pacing).toBe('EXPLANATORY');
    expect(flow).toEqual(
      expect.objectContaining({
        pattern: 'DETAILED_PROGRESSIVE_ANALYSIS',
        presentation: 'BULLETS',
        shouldSummarize: true,
      }),
    );
  });

  it('continuidade usa memória autorizada sem repetir aula', () => {
    const source = context({
      memory: true,
      followUp: true,
      repeatedTheme: 70,
    });
    const continuityComposition = composition({
      dialogueProfile: 'CONTINUITY_CHECK',
      centralIntent: 'FOLLOW_UP',
    });
    const style = stylePlanner.plan(source, continuityComposition, [
      'FOLLOW_UP_COMMITMENT',
    ]);
    const flow = flowPlanner.plan(source, decisionPlan('CONTINUITY_CHECK'));

    expect(style.openingStrategy).toBe('CONTINUITY');
    expect(flow.shouldContinueThread).toBe(true);
    expect(flow.suppressRepeatedEducation).toBe(true);
  });

  it('modula foco comportamental pelo estágio sem inferir perfil ausente', () => {
    const early = personalizationEngine.personalize(
      context({ stage: 'CONTEMPLATION' }),
    );
    const established = personalizationEngine.personalize(
      context({ stage: 'MAINTENANCE' }),
    );

    expect(early.behavioralFocus).toBe('HIGH');
    expect(established.behavioralFocus).toBe('MEDIUM');
  });

  it('mantém planejamento abaixo de 5 ms por interação', () => {
    const source = context({
      goal: 'MUSCLE_GAIN',
      activityLevel: 'ATHLETE',
      detailRequest: true,
      preferredLength: 1_000,
      longitudinal: true,
    });
    const sourceComposition = composition();
    const sourceDecision = decisionPlan('ACKNOWLEDGE_AND_ADJUST');
    const iterations = 1_000;
    const startedAt = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      const personalization = personalizationEngine.personalize(source);
      stylePlanner.plan(
        source,
        sourceComposition,
        ['RESPOND_TO_MEAL'],
        personalization,
      );
      flowPlanner.plan(source, sourceDecision, personalization);
    }
    expect((performance.now() - startedAt) / iterations).toBeLessThan(5);
  });
});
