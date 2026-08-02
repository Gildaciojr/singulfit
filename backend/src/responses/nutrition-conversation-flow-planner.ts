import type {
  ConversationBlockType,
  ConversationDialogueProfile,
} from './conversation-composition.contract';
import type { DecisionPlan } from './conversation-decision.contract';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';
import { NutritionConversationPersonalizationEngine } from './nutrition-conversation-personalization.engine';
import type {
  NutritionConversationFlowPattern,
  NutritionConversationFlowPlan,
  NutritionConversationPersonalization,
} from './nutrition-conversation-planning.contract';

const NATURAL_BLOCK_ORDER: readonly ConversationBlockType[] = Object.freeze([
  'PROFESSIONAL_BOUNDARY',
  'REFERRAL',
  'UNCERTAINTY_QUALIFICATION',
  'THREAD_RESUMPTION',
  'FACTUAL_ACKNOWLEDGEMENT',
  'EMOTIONAL_ACKNOWLEDGEMENT',
  'EFFORT_ACKNOWLEDGEMENT',
  'CELEBRATION',
  'DIRECT_ANSWER',
  'PRIMARY_OBSERVATION',
  'INTERPRETATION',
  'CAUSAL_EXPLANATION',
  'NUTRITION_EDUCATION',
  'CORRECTION',
  'PRIMARY_GUIDANCE',
  'PRACTICAL_ALTERNATIVE',
  'LIMITED_OPTIONS',
  'HISTORICAL_COMPARISON',
  'RELATIONAL_MEMORY',
  'TREND',
  'NORMALIZATION',
  'REFRAMING',
  'EVIDENCE_BASED_MOTIVATION',
  'AUTONOMY_REINFORCEMENT',
  'NEXT_STEP',
  'CONFIRMATION',
  'CLARIFYING_QUESTION',
  'EXPERIENTIAL_QUESTION',
  'REFLECTIVE_QUESTION',
  'CONTINUITY_INVITATION',
  'CONFIRMING_CLOSURE',
  'REASSURING_CLOSURE',
  'OPEN_CLOSURE',
  'MINIMAL_CLOSURE',
  'DIRECT_OPENING',
  'CONTEXTUAL_OPENING',
  'FACTUAL_REASSURANCE',
  'TOPIC_TRANSITION',
]);

export class NutritionConversationFlowPlanner {
  private readonly personalizationEngine =
    new NutritionConversationPersonalizationEngine();

  plan(
    context: NutritionConversationContext,
    decisionPlan: DecisionPlan,
    personalization: NutritionConversationPersonalization = this.personalizationEngine.personalize(
      context,
    ),
  ): NutritionConversationFlowPlan {
    const selected = new Set(
      decisionPlan.selectedDecisions.map((decision) => decision.candidateId),
    );
    const pattern = this.pattern(decisionPlan.dialogueProfile, personalization);
    const shouldTeach =
      !personalization.repetitionRisk &&
      ['TEACH_BRIEFLY', 'DETAILED_ANALYSIS'].includes(
        decisionPlan.dialogueProfile,
      );
    const shouldExplain =
      personalization.explanationLevel !== 'ANSWER_ONLY' &&
      decisionPlan.dialogueProfile !== 'CLARIFY_BEFORE_ANALYSIS';
    const shouldReinforce =
      personalization.motivationalIntensity !== 'NONE' &&
      (selected.has('nutrition.motivate-with-evidence') ||
        selected.has('nutrition.celebrate-improvement'));
    const shouldContinueThread =
      personalization.continuityAvailable &&
      ['CONTINUITY_CHECK', 'RECOVERY'].includes(decisionPlan.dialogueProfile);
    const rationaleCodes = new Set(personalization.rationaleCodes);
    rationaleCodes.add(`FLOW_${pattern}`);

    return Object.freeze({
      pattern,
      orderedBlockTypes: NATURAL_BLOCK_ORDER,
      presentation:
        decisionPlan.dialogueProfile === 'DETAILED_ANALYSIS' &&
        personalization.cognitiveLoad === 'HIGH'
          ? 'BULLETS'
          : 'PROSE',
      maximumQuestions: Math.min(
        personalization.questionBudget,
        decisionPlan.maximumQuestions,
      ) as 0 | 1,
      shouldExplain,
      shouldTeach,
      shouldReinforce,
      shouldSummarize:
        decisionPlan.dialogueProfile === 'DETAILED_ANALYSIS' &&
        personalization.cognitiveLoad !== 'LOW',
      shouldContinueThread,
      shouldConfirm:
        decisionPlan.dialogueProfile === 'CONTINUITY_CHECK' &&
        personalization.questionBudget === 1,
      suppressRepeatedEducation: personalization.repetitionRisk,
      rationaleCodes: Object.freeze([...rationaleCodes].sort()),
    });
  }

  paragraph(
    flow: NutritionConversationFlowPlan,
    blockType: ConversationBlockType,
    order: number,
  ): number {
    if (flow.pattern === 'DETAILED_PROGRESSIVE_ANALYSIS') return order;
    if (
      [
        'PROFESSIONAL_BOUNDARY',
        'REFERRAL',
        'UNCERTAINTY_QUALIFICATION',
        'THREAD_RESUMPTION',
        'FACTUAL_ACKNOWLEDGEMENT',
        'EMOTIONAL_ACKNOWLEDGEMENT',
        'EFFORT_ACKNOWLEDGEMENT',
        'CELEBRATION',
        'DIRECT_ANSWER',
        'PRIMARY_OBSERVATION',
      ].includes(blockType)
    ) {
      return 0;
    }
    if (
      flow.pattern === 'SHORT_ANSWER_REASON_CLOSING' ||
      flow.pattern === 'CLARIFICATION_BEFORE_ANALYSIS' ||
      flow.pattern === 'SAFETY_FIRST_GUIDANCE'
    ) {
      return 1;
    }
    if (
      [
        'INTERPRETATION',
        'CAUSAL_EXPLANATION',
        'NUTRITION_EDUCATION',
        'CORRECTION',
        'PRIMARY_GUIDANCE',
        'PRACTICAL_ALTERNATIVE',
        'HISTORICAL_COMPARISON',
        'RELATIONAL_MEMORY',
        'TREND',
      ].includes(blockType)
    ) {
      return 1;
    }
    return 2;
  }

  rank(
    flow: NutritionConversationFlowPlan,
    blockType: ConversationBlockType,
  ): number {
    const rank = flow.orderedBlockTypes.indexOf(blockType);
    return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
  }

  private pattern(
    profile: ConversationDialogueProfile,
    personalization: NutritionConversationPersonalization,
  ): NutritionConversationFlowPattern {
    if (personalization.safetySensitive) return 'SAFETY_FIRST_GUIDANCE';
    if (profile === 'CLARIFY_BEFORE_ANALYSIS')
      return 'CLARIFICATION_BEFORE_ANALYSIS';
    if (profile === 'DETAILED_ANALYSIS') return 'DETAILED_PROGRESSIVE_ANALYSIS';
    if (profile === 'CONTINUITY_CHECK' || profile === 'RECOVERY')
      return 'CONTINUITY_OBSERVATION_NEXT_STEP';
    if (profile === 'REFLECT_AND_ASK')
      return 'RECOGNITION_EXPLANATION_NEXT_STEP_QUESTION';
    if (profile === 'ACKNOWLEDGE_AND_ADJUST' || profile === 'TEACH_BRIEFLY') {
      return 'OBSERVATION_EXPLANATION_GUIDANCE_CLOSING';
    }
    return 'SHORT_ANSWER_REASON_CLOSING';
  }
}
