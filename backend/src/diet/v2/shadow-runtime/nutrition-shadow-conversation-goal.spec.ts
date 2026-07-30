import { parseNutritionShadowConversationGoal } from './nutrition-shadow-conversation-goal';

describe('Nutrition Shadow ConversationGoal parser', () => {
  it('preserves distinct official goals without inferring from artifacts', () => {
    expect(parseNutritionShadowConversationGoal('GENERAL_GUIDANCE')).toBe(
      'GENERAL_GUIDANCE',
    );
    expect(parseNutritionShadowConversationGoal('GENERATE_DIET_PLAN')).toBe(
      'GENERATE_DIET_PLAN',
    );
  });

  it('keeps historical absence readable and rejects unknown values', () => {
    expect(parseNutritionShadowConversationGoal(null)).toBeNull();
    expect(() => parseNutritionShadowConversationGoal('NOT_A_GOAL')).toThrow(
      'ConversationGoal persistido no Shadow está inválido',
    );
  });
});
