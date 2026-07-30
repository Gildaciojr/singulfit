import type { NutritionConversationContext } from './nutrition-conversation-context.interface';
import { NutritionConversationAuthorizedFactsBuilder } from './nutrition-conversation-authorized-facts.builder';
import { NutritionConversationComposer } from './nutrition-conversation-composer';
import { NutritionConversationDecisionEngine } from './nutrition-conversation-decision-engine';
import { NutritionConversationDecisionScoringPolicy } from './nutrition-conversation-decision-scoring-policy';
import { SanitizedConversationPayloadBuilder } from './sanitized-conversation-payload.builder';

function context(
  overrides: Partial<NutritionConversationContext> = {},
): NutritionConversationContext {
  return {
    metadata: { mealAnalysisId: 'episodic-analysis' },
    facts: {
      mealCategory: 'LUNCH',
      foods: [{ name: 'Frango', estimatedGrams: 120 }],
      totalCalories: 420,
      totalProtein: 35,
      totalCarbs: 40,
      totalFat: 12,
      qualityScore: 82,
      confidence: 0.92,
    },
    policies: { requiresEstimateQualification: false },
    userContext: {
      goal: 'MUSCLE_GAIN',
      activityLevel: 'MODERATE',
      relevantRestrictions: [],
      relevantAllergies: [],
      preferredLanguage: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      recentMeals: [],
    },
    direction: {
      supportingEvidence: { positiveFactors: [], limitingFactors: [] },
    },
    episodicMemory: {
      episodes: [
        {
          continuityKey: 'vegetable-commitment',
          category: 'COMMITMENT',
          fact: { action: 'incluir vegetais no almoço' },
          relationToContext: 'follow-up do almoço atual',
          recallReason: 'FOLLOW_UP_DUE',
          source: 'COACH',
          sensitivity: 'STANDARD',
        },
      ],
    },
    dialogue: {
      interactionIntent: 'FOLLOW_UP',
      explicitDetailRequest: false,
      specificQuestion: false,
      clarificationRequired: false,
      previousCommitmentAvailable: false,
    },
    communication: {
      communicationStyle: 'FRIENDLY',
      coachingStyle: 'MOTIVATIONAL',
      tone: 'MODERATE',
      motivationFocus: 'HEALTH',
      prefersShortMessages: false,
      preferredMessageLength: 500,
      idealEmojiCount: 0,
      fatigue: {
        score: 20,
        repeatedThemeScore: 10,
        repeatedPhraseScore: 10,
      },
      stageOfChange: 'PREPARATION',
      preferredTopics: [],
      ignoredTopics: [],
      shouldAskQuestion: false,
    },
    ...overrides,
  };
}

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(assertDeepFrozen);
}

describe('Nutrition conversation episodic memory pipeline', () => {
  it('creates optional episodic candidates without making recall mandatory', () => {
    const candidates = new NutritionConversationDecisionEngine().generate(
      context(),
    );
    const commitment = candidates.find(
      (candidate) => candidate.id === 'nutrition.check-commitment',
    );

    expect(commitment).toEqual(
      expect.objectContaining({
        required: false,
        category: 'MEMORY',
        factIds: ['episodicMemory.COMMITMENT'],
      }),
    );
    expect(
      new NutritionConversationDecisionEngine()
        .generate({ ...context(), episodicMemory: undefined })
        .some((candidate) => candidate.id === 'nutrition.check-commitment'),
    ).toBe(false);
  });

  it('builds a sanitized continuity payload without ids, lifecycle or scoring metadata', () => {
    const source = context();
    const candidates = new NutritionConversationDecisionEngine().generate(
      source,
    );
    const decisionPlan =
      new NutritionConversationDecisionScoringPolicy().select(
        source,
        candidates,
      );
    const compositionPlan = new NutritionConversationComposer().compose(
      source,
      decisionPlan,
    );
    const authorizedFacts =
      new NutritionConversationAuthorizedFactsBuilder().build(source);
    const payload = new SanitizedConversationPayloadBuilder().build({
      context: source,
      authorizedFacts,
      decisionPlan,
      compositionPlan,
    });
    const episode = payload.facts.allowed.find(
      (fact) => fact.key === 'episodicMemory.COMMITMENT',
    );
    const serialized = JSON.stringify(payload);

    expect(decisionPlan.dialogueProfile).toBe('CONTINUITY_CHECK');
    expect(decisionPlan.selectedDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ candidateId: 'nutrition.check-commitment' }),
      ]),
    );
    expect(episode?.value).toEqual({
      category: 'COMMITMENT',
      fact: { action: 'incluir vegetais no almoço' },
      relationToContext: 'follow-up do almoço atual',
      recallReason: 'FOLLOW_UP_DUE',
    });
    expect(serialized).not.toMatch(
      /vegetable-commitment|continuityKey|createdAtLogical|expiresAtLogical|lifecycle|importance|heuristic/i,
    );
    expect(serialized).not.toContain('nutrition.check-commitment');
    assertDeepFrozen(payload);
  });

  it('suppresses episodic recall under high fatigue and preserves deterministic output', () => {
    const base = context();
    const fatigued = context({
      communication: {
        ...base.communication,
        fatigue: {
          score: 90,
          repeatedThemeScore: 90,
          repeatedPhraseScore: 90,
        },
      },
    });
    const candidates = new NutritionConversationDecisionEngine().generate(
      fatigued,
    );
    const policy = new NutritionConversationDecisionScoringPolicy();
    const first = policy.select(fatigued, candidates);
    const second = policy.select(fatigued, candidates);

    expect(second).toEqual(first);
    expect(
      first.selectedDecisions.some(
        (decision) => decision.candidateId === 'nutrition.check-commitment',
      ),
    ).toBe(false);
    expect(
      first.suppressedDecisions.find(
        (decision) => decision.candidateId === 'nutrition.check-commitment',
      )?.reason,
    ).toMatch(/FATIGUE|PROFILE_MISMATCH/);
  });
});
