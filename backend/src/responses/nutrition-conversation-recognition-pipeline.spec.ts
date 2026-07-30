import {
  CoachCoachingStyle,
  CoachTone,
  FitnessGoal,
  MealCategory,
  StageOfChange,
} from '@prisma/client';
import { NutritionConversationAuthorizedFactsBuilder } from './nutrition-conversation-authorized-facts.builder';
import { NutritionConversationComposer } from './nutrition-conversation-composer';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';
import { NutritionConversationDecisionEngine } from './nutrition-conversation-decision-engine';
import { NutritionConversationDecisionScoringPolicy } from './nutrition-conversation-decision-scoring-policy';
import { SanitizedConversationPayloadBuilder } from './sanitized-conversation-payload.builder';

function context(
  recognition: NutritionConversationContext['recognition'],
  fatigue = 0,
): NutritionConversationContext {
  return {
    metadata: { mealAnalysisId: 'analysis-id' },
    facts: {
      mealCategory: MealCategory.LUNCH,
      foods: [{ name: 'Frango', estimatedGrams: 120 }],
      totalCalories: null,
      totalProtein: null,
      totalCarbs: null,
      totalFat: null,
      qualityScore: null,
    },
    policies: { requiresEstimateQualification: true },
    userContext: {
      goal: FitnessGoal.MUSCLE_GAIN,
      activityLevel: null,
      relevantRestrictions: [],
      relevantAllergies: [],
      preferredLanguage: 'pt-BR',
      timezone: null,
      recentMeals: [],
    },
    direction: {
      supportingEvidence: { positiveFactors: [], limitingFactors: [] },
    },
    recognition,
    communication: {
      communicationStyle: 'FRIENDLY',
      coachingStyle: CoachCoachingStyle.MOTIVATIONAL,
      tone: CoachTone.MODERATE,
      motivationFocus: 'HEALTH',
      prefersShortMessages: false,
      preferredMessageLength: 600,
      idealEmojiCount: 0,
      fatigue: {
        score: fatigue,
        repeatedThemeScore: fatigue,
        repeatedPhraseScore: fatigue,
      },
      stageOfChange: StageOfChange.ACTION,
      preferredTopics: [],
      ignoredTopics: [],
      shouldAskQuestion: false,
    },
  };
}

describe('Nutrition recognition pipeline', () => {
  const engine = new NutritionConversationDecisionEngine();
  const policy = new NutritionConversationDecisionScoringPolicy();
  const composer = new NutritionConversationComposer();
  const factsBuilder = new NutritionConversationAuthorizedFactsBuilder();
  const payloadBuilder = new SanitizedConversationPayloadBuilder();

  it('selects recovery first and merges it into an existing conversational block', () => {
    const source = context({
      signals: [
        {
          kind: 'RECOVERY',
          origin: 'LONGITUDINAL',
          confidence: 'HIGH',
          evidence: ['retomada após uma oscilação'],
          goalRelation: 'MUSCLE_GAIN',
        },
        {
          kind: 'EFFORT',
          origin: 'COACH',
          confidence: 'MEDIUM',
          evidence: ['uma escolha favorável foi repetida'],
        },
      ],
    });
    const candidates = engine.generate(source);
    const plan = policy.select(source, candidates);
    const composition = composer.compose(source, plan);
    const payload = payloadBuilder.build({
      context: source,
      authorizedFacts: factsBuilder.build(source),
      decisionPlan: plan,
      compositionPlan: composition,
    });

    expect(plan.selectedDecisions.map((item) => item.candidateId)).toContain(
      'nutrition.acknowledge-recovery',
    );
    expect(
      plan.selectedDecisions.map((item) => item.candidateId),
    ).not.toContain('nutrition.acknowledge-effort');
    const recoveryBlock = composition.blocks.find((block) =>
      block.decisionIds.includes('nutrition.acknowledge-recovery'),
    );
    expect(recoveryBlock?.decisionIds).toContain('nutrition.respond-to-meal');
    expect(payload.selectedDecisions).toContain('ACKNOWLEDGE_RECOVERY');
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain('retomada após uma oscilação');
    expect(serialized).not.toMatch(
      /analysis-id|confidence|score|heuristic|metadata/i,
    );
  });

  it('creates no recognition candidates without evidence and suppresses recognition under high fatigue', () => {
    const specificRecognitionIds = new Set([
      'nutrition.acknowledge-effort',
      'nutrition.acknowledge-progress',
      'nutrition.acknowledge-recovery',
      'nutrition.acknowledge-small-win',
      'nutrition.acknowledge-consistency',
      'nutrition.acknowledge-strategy',
      'nutrition.acknowledge-discipline',
      'nutrition.acknowledge-improvement',
    ]);
    expect(
      engine
        .generate(context(undefined))
        .some((candidate) => specificRecognitionIds.has(candidate.id)),
    ).toBe(false);
    const fatigued = context(
      {
        signals: [
          {
            kind: 'SMALL_WIN',
            origin: 'LONGITUDINAL',
            confidence: 'HIGH',
            evidence: ['melhora comparativa observada'],
          },
        ],
      },
      80,
    );
    const plan = policy.select(fatigued, engine.generate(fatigued));
    expect(
      plan.selectedDecisions.map((item) => item.candidateId),
    ).not.toContain('nutrition.acknowledge-small-win');
  });
});
