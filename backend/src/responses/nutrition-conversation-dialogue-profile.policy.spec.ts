import type { SelectedDecision } from './conversation-decision.contract';
import { NutritionConversationComposer } from './nutrition-conversation-composer';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';
import { NutritionConversationDecisionEngine } from './nutrition-conversation-decision-engine';
import { NutritionConversationDecisionScoringPolicy } from './nutrition-conversation-decision-scoring-policy';
import { NutritionConversationDialogueProfilePolicy } from './nutrition-conversation-dialogue-profile.policy';

type Scenario =
  | 'ACKNOWLEDGE_ONLY'
  | 'ACKNOWLEDGE_AND_ADJUST'
  | 'REFLECT_AND_ASK'
  | 'TEACH_BRIEFLY'
  | 'RECOVERY'
  | 'CELEBRATE'
  | 'DETAILED_ANALYSIS'
  | 'CLARIFY_BEFORE_ANALYSIS'
  | 'REASSURE_AND_SIMPLIFY'
  | 'CONTINUITY_CHECK';

function selected(candidateId: string): SelectedDecision {
  return {
    candidateId,
    code: 'TEST',
    intrinsicPriority: 'P2',
    order: 0,
    factIds: ['facts.foods'],
    rationaleCodes: ['TEST'],
  };
}

function context(scenario: Scenario): NutritionConversationContext {
  const correction = scenario === 'ACKNOWLEDGE_AND_ADJUST';
  const detailed = scenario === 'DETAILED_ANALYSIS';
  const continuity = scenario === 'CONTINUITY_CHECK';
  const clarify = scenario === 'CLARIFY_BEFORE_ANALYSIS';
  const reassure = scenario === 'REASSURE_AND_SIMPLIFY';
  const recognitionKind =
    scenario === 'RECOVERY'
      ? 'RECOVERY'
      : scenario === 'CELEBRATE'
        ? 'BIG_WIN'
        : scenario === 'ACKNOWLEDGE_ONLY' || correction
          ? 'GOOD_DECISION'
          : undefined;
  const emotionalKind =
    scenario === 'TEACH_BRIEFLY'
      ? 'CURIOSITY'
      : reassure
        ? 'OVERWHELM'
        : undefined;

  return {
    metadata: { mealAnalysisId: `scenario-${scenario}` },
    facts: {
      mealCategory: 'LUNCH',
      foods: detailed
        ? [
            { name: 'Frango', estimatedGrams: 120 },
            { name: 'Arroz', estimatedGrams: 100 },
            { name: 'Salada', estimatedGrams: 80 },
          ]
        : [{ name: 'Frango', estimatedGrams: 120 }],
      totalCalories: 520,
      totalProtein: 38,
      totalCarbs: 55,
      totalFat: 16,
      qualityScore: 82,
      confidence: clarify ? 0.5 : 0.92,
    },
    policies: { requiresEstimateQualification: false },
    userContext: {
      goal: 'MUSCLE_GAIN',
      activityLevel: 'MODERATE',
      relevantRestrictions: [],
      relevantAllergies: [],
      preferredLanguage: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      ...(continuity ? { memory: { summary: 'Compromisso anterior' } } : {}),
      recentMeals: [],
    },
    direction: {
      ...(correction
        ? {
            authorizedRecommendation: {
              title: 'Ajuste simples',
              action: 'Adicionar vegetais.',
            },
          }
        : {}),
      supportingEvidence: {
        positiveFactors:
          scenario === 'ACKNOWLEDGE_ONLY' || correction
            ? ['Proteína adequada']
            : [],
        limitingFactors: correction ? ['Poucas fibras'] : [],
      },
    },
    ...(recognitionKind
      ? {
          recognition: {
            signals: [
              {
                kind: recognitionKind,
                origin: 'BEHAVIOR',
                confidence: 'HIGH',
                evidence: ['Evidência objetiva'],
              },
            ],
          },
        }
      : {}),
    ...(emotionalKind
      ? {
          emotional: {
            signals: [
              {
                kind: emotionalKind,
                origin: 'BEHAVIOR',
                confidence: 'HIGH',
                evidence: ['Evidência objetiva'],
              },
            ],
          },
        }
      : {}),
    dialogue: {
      interactionIntent: detailed
        ? 'DETAIL_REQUEST'
        : continuity
          ? 'FOLLOW_UP'
          : scenario === 'TEACH_BRIEFLY'
            ? 'SPECIFIC_QUESTION'
            : [
                  'REFLECT_AND_ASK',
                  'RECOVERY',
                  'CELEBRATE',
                  'REASSURE_AND_SIMPLIFY',
                ].includes(scenario)
              ? 'FOLLOW_UP'
              : 'MEAL_ANALYSIS',
      explicitDetailRequest: detailed,
      specificQuestion: scenario === 'TEACH_BRIEFLY',
      clarificationRequired: clarify,
      previousCommitmentAvailable: continuity,
    },
    communication: {
      communicationStyle: 'FRIENDLY',
      coachingStyle: 'MOTIVATIONAL',
      tone: 'MODERATE',
      motivationFocus: 'HEALTH',
      prefersShortMessages: false,
      preferredMessageLength: detailed ? 900 : 500,
      idealEmojiCount: 1,
      fatigue: {
        score: reassure ? 80 : 20,
        repeatedThemeScore: reassure ? 80 : 10,
        repeatedPhraseScore: reassure ? 80 : 10,
      },
      stageOfChange: 'PREPARATION',
      preferredTopics: [],
      ignoredTopics: [],
      shouldAskQuestion: scenario === 'REFLECT_AND_ASK',
    },
  };
}

const CASES: readonly [Scenario, readonly SelectedDecision[]][] = [
  ['ACKNOWLEDGE_ONLY', [selected('nutrition.respond-to-meal')]],
  ['ACKNOWLEDGE_AND_ADJUST', [selected('nutrition.respond-to-meal')]],
  [
    'REFLECT_AND_ASK',
    [selected('nutrition.respond-to-meal'), selected('nutrition.ask-question')],
  ],
  ['TEACH_BRIEFLY', [selected('nutrition.respond-to-meal')]],
  ['RECOVERY', [selected('nutrition.respond-to-meal')]],
  ['CELEBRATE', [selected('nutrition.respond-to-meal')]],
  ['DETAILED_ANALYSIS', [selected('nutrition.respond-to-meal')]],
  ['CLARIFY_BEFORE_ANALYSIS', [selected('nutrition.respond-to-meal')]],
  ['REASSURE_AND_SIMPLIFY', [selected('nutrition.respond-to-meal')]],
  ['CONTINUITY_CHECK', [selected('nutrition.respond-to-meal')]],
];

describe('NutritionConversationDialogueProfilePolicy', () => {
  const profilePolicy = new NutritionConversationDialogueProfilePolicy();

  it.each(CASES)('selects %s deterministically', (expected, decisions) => {
    const source = context(expected);
    const first = profilePolicy.select(source, decisions);
    const second = profilePolicy.select(source, decisions);

    expect(first.profile).toBe(expected);
    expect(second).toEqual(first);
    expect(first.centralIntent).toBe(first.definition.centralIntent);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.definition)).toBe(true);
    expect(Object.isFrozen(first.definition.budgets)).toBe(true);
  });

  it.each(CASES)(
    'keeps the complete %s orchestration within its structural profile',
    (expected) => {
      const source = context(expected);
      const candidates = new NutritionConversationDecisionEngine().generate(
        source,
      );
      const plan = new NutritionConversationDecisionScoringPolicy().select(
        source,
        candidates,
      );
      const composition = new NutritionConversationComposer().compose(
        source,
        plan,
      );
      const definition = profilePolicy.definition(expected);

      expect(plan.dialogueProfile).toBe(expected);
      expect(plan.centralIntent).toBe(definition.centralIntent);
      expect(composition.dialogueProfile).toBe(expected);
      expect(composition.paragraphCount).toBeLessThanOrEqual(
        definition.budgets.maximumParagraphCount,
      );
      expect(composition.blocks.length).toBeLessThanOrEqual(
        definition.budgets.maximumBlockCount,
      );
      expect(
        composition.blocks.every(
          (block) =>
            definition.allowedBlocks.includes(block.type) &&
            !definition.prohibitedBlocks.includes(block.type),
        ),
      ).toBe(true);
      expect(Object.isFrozen(composition)).toBe(true);
      expect(Object.isFrozen(composition.blocks)).toBe(true);
    },
  );

  it('does not mutate context or use clock, randomness, providers or persistence', () => {
    const source = context('DETAILED_ANALYSIS');
    const before = JSON.stringify(source);

    profilePolicy.select(source, [selected('nutrition.respond-to-meal')]);

    expect(JSON.stringify(source)).toBe(before);
    expect(JSON.stringify(profilePolicy)).not.toMatch(
      /Date\.now|Math\.random|OpenAI|Prisma|Repository|Service/,
    );
  });
});
