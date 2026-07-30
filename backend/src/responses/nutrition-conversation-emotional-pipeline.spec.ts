import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import type { NutritionEmotionalSignalKind } from './nutrition-conversation-emotional.contract';
import { SanitizedConversationPayloadBuilder } from './sanitized-conversation-payload.builder';

function context(
  kinds: readonly NutritionEmotionalSignalKind[],
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
    emotional: {
      signals: kinds.map((kind) => ({
        kind,
        origin: kind === 'UNCERTAINTY' ? 'MEAL_ANALYSIS' : 'LONGITUDINAL',
        confidence: 'HIGH',
        evidence: [`evidência autorizada para ${kind}`],
      })),
    },
    communication: {
      communicationStyle: 'FRIENDLY',
      coachingStyle: CoachCoachingStyle.MOTIVATIONAL,
      tone: CoachTone.MODERATE,
      motivationFocus: 'HEALTH',
      prefersShortMessages: false,
      preferredMessageLength: 800,
      idealEmojiCount: 0,
      fatigue: {
        score: 0,
        repeatedThemeScore: 0,
        repeatedPhraseScore: 0,
      },
      stageOfChange: StageOfChange.ACTION,
      preferredTopics: [],
      ignoredTopics: [],
      shouldAskQuestion: false,
    },
  };
}

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(assertDeepFrozen);
}

describe('Nutrition emotional conversation pipeline', () => {
  const engine = new NutritionConversationDecisionEngine();
  const policy = new NutritionConversationDecisionScoringPolicy();
  const composer = new NutritionConversationComposer();
  const factsBuilder = new NutritionConversationAuthorizedFactsBuilder();
  const payloadBuilder = new SanitizedConversationPayloadBuilder();

  it('generates every emotional decision as optional and evidence-bound', () => {
    const source = context([
      'FRUSTRATION',
      'CONFIDENCE',
      'OVERWHELM',
      'UNCERTAINTY',
      'MOTIVATION',
      'SATISFACTION',
      'REENGAGEMENT',
      'FATIGUE',
      'RESISTANCE',
      'CURIOSITY',
    ]);
    const emotional = engine
      .generate(source)
      .filter((candidate) =>
        candidate.factIds.some((id) => id.startsWith('emotional.')),
      );

    expect(emotional.map((candidate) => candidate.id)).toEqual([
      'nutrition.validate-frustration',
      'nutrition.reinforce-confidence',
      'nutrition.reduce-cognitive-load',
      'nutrition.normalize-setback',
      'nutrition.simplify-guidance',
      'nutrition.encourage-continuity',
      'nutrition.answer-curiosity',
    ]);
    expect(emotional.every((candidate) => !candidate.required)).toBe(true);
    expect(emotional.every((candidate) => candidate.factIds.length > 0)).toBe(
      true,
    );
  });

  it('lets Policy compete emotional decisions and Composer enrich an existing block', () => {
    const source = context(['FRUSTRATION']);
    const plan = policy.select(source, engine.generate(source));
    const composition = composer.compose(source, plan);
    const selected = plan.selectedDecisions.map((item) => item.candidateId);

    expect(selected).toContain('nutrition.validate-frustration');
    expect(selected).not.toContain('nutrition.normalize-setback');
    const emotionalBlock = composition.blocks.find((block) =>
      block.decisionIds.includes('nutrition.validate-frustration'),
    );
    expect(emotionalBlock?.type).toBe('PRIMARY_OBSERVATION');
  });

  it('exports only state and authorized evidence to facts and sanitized payload', () => {
    const source = context(['FRUSTRATION']);
    const candidates = engine.generate(source);
    const plan = policy.select(source, candidates);
    const composition = composer.compose(source, plan);
    const authorizedFacts = factsBuilder.build(source);
    const payload = payloadBuilder.build({
      context: source,
      authorizedFacts,
      decisionPlan: plan,
      compositionPlan: composition,
    });
    const emotionalFact = authorizedFacts.allowed.find(
      (fact) => fact.id === 'emotional.FRUSTRATION',
    );

    expect(emotionalFact?.value).toEqual({
      kind: 'FRUSTRATION',
      evidence: ['evidência autorizada para FRUSTRATION'],
    });
    expect(payload.selectedDecisions).toContain('VALIDATE_FRUSTRATION');
    expect(JSON.stringify(payload)).not.toMatch(
      /analysis-id|mealAnalysisId|decisionId|blockId|heuristic|confidence|score/i,
    );
    assertDeepFrozen(authorizedFacts);
    assertDeepFrozen(payload);
  });

  it('is deterministic and does not mutate the context', () => {
    const source = context(['FRUSTRATION']);
    const snapshot = JSON.stringify(source);
    const execute = () => {
      const candidates = engine.generate(source);
      const plan = policy.select(source, candidates);
      return composer.compose(source, plan);
    };
    const first = execute();

    expect(execute()).toEqual(first);
    expect(JSON.stringify(source)).toBe(snapshot);
    assertDeepFrozen(first);
  });

  it('keeps the emotional pipeline isolated from protected infrastructure', () => {
    const files = [
      'nutrition-conversation-emotional-engine.ts',
      'nutrition-conversation-decision-engine.ts',
      'nutrition-conversation-decision-scoring-policy.ts',
      'nutrition-conversation-composer.ts',
    ];
    const source = files
      .map((file) => readFileSync(join(__dirname, file), 'utf8'))
      .join('\n');

    expect(source).not.toMatch(
      /PrismaService|OpenAI|ConversationAI|Evolution|Worker|Outbox|EventBus|fetch\(|Date\.now|Math\.random|console\.log|\bany\b/,
    );
  });
});
