import type { NutritionConversationContext } from './nutrition-conversation-context.interface';

const COMPACT_MEAL_DECISIONS = new Set([
  'nutrition.respond-to-meal',
  'nutrition.qualify-estimates',
  'nutrition.show-calories',
  'nutrition.show-protein',
  'nutrition.show-carbohydrates',
  'nutrition.show-fat',
  'nutrition.show-quality',
  'nutrition.mention-goal',
  'nutrition.provide-recommendation',
  'nutrition.correct-limiting-factor',
  'nutrition.respond-briefly',
  'nutrition.reduce-conversational-load',
  'nutrition.use-emoji',
]);

export function isCompactMealAnalysis(
  context: NutritionConversationContext,
): boolean {
  const uncertain = (context.emotional?.signals ?? []).some(
    (signal) => signal.kind === 'UNCERTAINTY',
  );

  return (
    context.dialogue?.interactionIntent === 'MEAL_ANALYSIS' &&
    context.dialogue.specificQuestion !== true &&
    context.dialogue.explicitDetailRequest !== true &&
    context.dialogue.clarificationRequired !== true &&
    context.facts.foods.length > 0 &&
    (context.facts.confidence === undefined ||
      context.facts.confidence >= 0.7) &&
    !uncertain
  );
}

export function allowsCompactMealDecision(candidateId: string): boolean {
  return COMPACT_MEAL_DECISIONS.has(candidateId);
}
