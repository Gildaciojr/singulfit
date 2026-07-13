import type { AuthorizedFactId } from './conversation-authorized-facts.contract';
import type {
  ConversationDecisionCategory,
  ConversationDecisionId,
  ConversationDecisionIntrinsicPriority,
  DecisionCandidate,
} from './conversation-decision.contract';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';

const DECISION_ID = {
  RESPOND_TO_MEAL: 'nutrition.respond-to-meal',
  QUALIFY_ESTIMATES: 'nutrition.qualify-estimates',
  ACKNOWLEDGE_MEAL: 'nutrition.acknowledge-meal',
  SHOW_CALORIES: 'nutrition.show-calories',
  SHOW_PROTEIN: 'nutrition.show-protein',
  SHOW_CARBOHYDRATES: 'nutrition.show-carbohydrates',
  SHOW_FAT: 'nutrition.show-fat',
  SHOW_QUALITY: 'nutrition.show-quality',
  MENTION_GOAL: 'nutrition.mention-goal',
  USE_MEMORY: 'nutrition.use-memory',
  COMPARE_HISTORY: 'nutrition.compare-history',
  MENTION_INSIGHT: 'nutrition.mention-insight',
  MENTION_TREND: 'nutrition.mention-trend',
  MENTION_LONGITUDINAL: 'nutrition.mention-longitudinal',
  PROVIDE_RECOMMENDATION: 'nutrition.provide-recommendation',
  ACKNOWLEDGE_POSITIVE: 'nutrition.acknowledge-positive',
  CORRECT_LIMITING_FACTOR: 'nutrition.correct-limiting-factor',
  CELEBRATE_IMPROVEMENT: 'nutrition.celebrate-improvement',
  MOTIVATE_WITH_EVIDENCE: 'nutrition.motivate-with-evidence',
  ASK_QUESTION: 'nutrition.ask-question',
  CLOSE_WITHOUT_QUESTION: 'nutrition.close-without-question',
  RESPOND_BRIEFLY: 'nutrition.respond-briefly',
  REDUCE_CONVERSATIONAL_LOAD: 'nutrition.reduce-conversational-load',
  USE_EMOJI: 'nutrition.use-emoji',
} as const;

const ORIGIN = {
  FACTS: 'NUTRITION_CONTEXT_FACTS',
  POLICY: 'NUTRITION_CONTEXT_POLICY',
  USER_CONTEXT: 'NUTRITION_CONTEXT_USER_CONTEXT',
  DIRECTION: 'NUTRITION_CONTEXT_DIRECTION',
  COMMUNICATION: 'NUTRITION_CONTEXT_COMMUNICATION',
} as const;

interface CandidateDefinition {
  readonly id: ConversationDecisionId;
  readonly origin: (typeof ORIGIN)[keyof typeof ORIGIN];
  readonly category: ConversationDecisionCategory;
  readonly intrinsicPriority: ConversationDecisionIntrinsicPriority;
  readonly factIds: readonly AuthorizedFactId[];
  readonly dependencyIds?: readonly ConversationDecisionId[];
  readonly complementaryIds?: readonly ConversationDecisionId[];
  readonly conflictingIds?: readonly ConversationDecisionId[];
  readonly rationale: string;
  readonly required?: boolean;
}

export class NutritionConversationDecisionEngine {
  generate(
    context: NutritionConversationContext,
  ): readonly DecisionCandidate[] {
    const candidates: DecisionCandidate[] = [];

    candidates.push(
      this.candidate({
        id: DECISION_ID.RESPOND_TO_MEAL,
        origin: ORIGIN.FACTS,
        category: 'INTENT',
        intrinsicPriority: 'P1',
        factIds: ['facts.mealCategory', 'facts.foods'],
        rationale: 'MEAL_ANALYSIS_CONTEXT_AVAILABLE',
        required: true,
      }),
    );

    if (context.policies.requiresEstimateQualification) {
      candidates.push(
        this.candidate({
          id: DECISION_ID.QUALIFY_ESTIMATES,
          origin: ORIGIN.POLICY,
          category: 'SAFETY',
          intrinsicPriority: 'P0',
          factIds: [
            'facts.foods',
            ...(context.facts.totalCalories !== null
              ? ['facts.totalCalories']
              : []),
            ...(context.facts.totalProtein !== null
              ? ['facts.totalProtein']
              : []),
            ...(context.facts.totalCarbs !== null ? ['facts.totalCarbs'] : []),
            ...(context.facts.totalFat !== null ? ['facts.totalFat'] : []),
          ],
          dependencyIds: [DECISION_ID.RESPOND_TO_MEAL],
          rationale: 'ESTIMATED_NUTRITION_DATA_REQUIRES_QUALIFICATION',
          required: true,
        }),
      );
    }

    if (context.facts.foods.length > 0) {
      candidates.push(
        this.candidate({
          id: DECISION_ID.ACKNOWLEDGE_MEAL,
          origin: ORIGIN.FACTS,
          category: 'RECOGNITION',
          intrinsicPriority: 'P2',
          factIds: ['facts.foods', 'facts.mealCategory'],
          dependencyIds: [DECISION_ID.RESPOND_TO_MEAL],
          rationale: 'CURRENT_MEAL_HAS_IDENTIFIED_FOODS',
        }),
      );
    }

    this.addNumericFactCandidate(
      candidates,
      context.facts.totalCalories,
      DECISION_ID.SHOW_CALORIES,
      'facts.totalCalories',
      'CALORIES_AVAILABLE',
    );
    this.addNumericFactCandidate(
      candidates,
      context.facts.totalProtein,
      DECISION_ID.SHOW_PROTEIN,
      'facts.totalProtein',
      'PROTEIN_AVAILABLE',
    );
    this.addNumericFactCandidate(
      candidates,
      context.facts.totalCarbs,
      DECISION_ID.SHOW_CARBOHYDRATES,
      'facts.totalCarbs',
      'CARBOHYDRATES_AVAILABLE',
    );
    this.addNumericFactCandidate(
      candidates,
      context.facts.totalFat,
      DECISION_ID.SHOW_FAT,
      'facts.totalFat',
      'FAT_AVAILABLE',
    );
    this.addNumericFactCandidate(
      candidates,
      context.facts.qualityScore,
      DECISION_ID.SHOW_QUALITY,
      'facts.qualityScore',
      'QUALITY_SCORE_AVAILABLE',
    );

    if (context.userContext.goal !== null) {
      candidates.push(
        this.candidate({
          id: DECISION_ID.MENTION_GOAL,
          origin: ORIGIN.USER_CONTEXT,
          category: 'CONTINUITY',
          intrinsicPriority: 'P3',
          factIds: ['userContext.goal'],
          dependencyIds: [DECISION_ID.RESPOND_TO_MEAL],
          rationale: 'USER_GOAL_AVAILABLE',
        }),
      );
    }

    if (context.userContext.memory) {
      candidates.push(
        this.candidate({
          id: DECISION_ID.USE_MEMORY,
          origin: ORIGIN.USER_CONTEXT,
          category: 'MEMORY',
          intrinsicPriority: 'P3',
          factIds: ['userContext.memory'],
          dependencyIds: [DECISION_ID.RESPOND_TO_MEAL],
          rationale: 'RELEVANT_MEMORY_AVAILABLE',
        }),
      );
    }

    if (context.userContext.recentMeals.length > 0) {
      candidates.push(
        this.candidate({
          id: DECISION_ID.COMPARE_HISTORY,
          origin: ORIGIN.USER_CONTEXT,
          category: 'CONTINUITY',
          intrinsicPriority: 'P3',
          factIds: ['facts.qualityScore', 'userContext.recentMeals'],
          dependencyIds: [DECISION_ID.RESPOND_TO_MEAL],
          rationale: 'RECENT_MEAL_REFERENCE_AVAILABLE',
        }),
      );
    }

    if (context.userContext.insight) {
      candidates.push(
        this.candidate({
          id: DECISION_ID.MENTION_INSIGHT,
          origin: ORIGIN.USER_CONTEXT,
          category: 'EDUCATION',
          intrinsicPriority: 'P3',
          factIds: ['userContext.insight'],
          dependencyIds: [DECISION_ID.RESPOND_TO_MEAL],
          rationale: 'ACTIVE_NUTRITION_INSIGHT_AVAILABLE',
        }),
      );
    }

    if (context.userContext.trend) {
      candidates.push(
        this.candidate({
          id: DECISION_ID.MENTION_TREND,
          origin: ORIGIN.USER_CONTEXT,
          category: 'CONTINUITY',
          intrinsicPriority: 'P3',
          factIds: ['userContext.trend'],
          dependencyIds: [DECISION_ID.RESPOND_TO_MEAL],
          rationale: 'NUTRITION_TREND_AVAILABLE',
        }),
      );
    }

    if (context.userContext.longitudinalSignal) {
      candidates.push(
        this.candidate({
          id: DECISION_ID.MENTION_LONGITUDINAL,
          origin: ORIGIN.USER_CONTEXT,
          category: 'CONTINUITY',
          intrinsicPriority: 'P3',
          factIds: ['userContext.longitudinalSignal'],
          dependencyIds: [DECISION_ID.RESPOND_TO_MEAL],
          rationale: 'LONGITUDINAL_SIGNAL_AVAILABLE',
        }),
      );
    }

    if (context.direction.authorizedRecommendation) {
      candidates.push(
        this.candidate({
          id: DECISION_ID.PROVIDE_RECOMMENDATION,
          origin: ORIGIN.DIRECTION,
          category: 'CORRECTION',
          intrinsicPriority: 'P2',
          factIds: ['direction.authorizedRecommendation'],
          dependencyIds: [DECISION_ID.RESPOND_TO_MEAL],
          rationale: 'AUTHORIZED_RECOMMENDATION_AVAILABLE',
        }),
      );
    }

    const positiveFactors =
      context.direction.supportingEvidence.positiveFactors;
    const limitingFactors =
      context.direction.supportingEvidence.limitingFactors;

    if (positiveFactors.length > 0) {
      candidates.push(
        this.candidate({
          id: DECISION_ID.ACKNOWLEDGE_POSITIVE,
          origin: ORIGIN.DIRECTION,
          category: 'RECOGNITION',
          intrinsicPriority: 'P3',
          factIds: ['direction.supportingEvidence.positiveFactors'],
          complementaryIds:
            context.facts.foods.length > 0
              ? [DECISION_ID.ACKNOWLEDGE_MEAL]
              : [],
          rationale: 'POSITIVE_SUPPORTING_EVIDENCE_AVAILABLE',
        }),
      );
    }

    if (limitingFactors.length > 0) {
      candidates.push(
        this.candidate({
          id: DECISION_ID.CORRECT_LIMITING_FACTOR,
          origin: ORIGIN.DIRECTION,
          category: 'CORRECTION',
          intrinsicPriority: 'P2',
          factIds: ['direction.supportingEvidence.limitingFactors'],
          dependencyIds: [DECISION_ID.RESPOND_TO_MEAL],
          rationale: 'LIMITING_SUPPORTING_EVIDENCE_AVAILABLE',
        }),
      );
    }

    const improvementAvailable = this.hasImprovement(context);

    if (improvementAvailable) {
      candidates.push(
        this.candidate({
          id: DECISION_ID.CELEBRATE_IMPROVEMENT,
          origin: ORIGIN.USER_CONTEXT,
          category: 'CELEBRATION',
          intrinsicPriority: 'P3',
          factIds: this.improvementFactIds(context),
          dependencyIds: [DECISION_ID.RESPOND_TO_MEAL],
          rationale: 'IMPROVEMENT_SIGNAL_AVAILABLE',
        }),
      );
    }

    if (positiveFactors.length > 0 || improvementAvailable) {
      candidates.push(
        this.candidate({
          id: DECISION_ID.MOTIVATE_WITH_EVIDENCE,
          origin: ORIGIN.DIRECTION,
          category: 'MOTIVATION',
          intrinsicPriority: 'P4',
          factIds: [
            ...(positiveFactors.length > 0
              ? ['direction.supportingEvidence.positiveFactors']
              : []),
            ...this.improvementFactIds(context),
          ],
          complementaryIds: [
            ...(positiveFactors.length > 0
              ? [DECISION_ID.ACKNOWLEDGE_POSITIVE]
              : []),
            ...(improvementAvailable
              ? [DECISION_ID.CELEBRATE_IMPROVEMENT]
              : []),
          ],
          rationale: 'EVIDENCE_SUPPORTS_MOTIVATION',
        }),
      );
    }

    candidates.push(
      this.candidate({
        id: DECISION_ID.ASK_QUESTION,
        origin: ORIGIN.COMMUNICATION,
        category: 'CURIOSITY',
        intrinsicPriority: 'P2',
        factIds: [
          'communication.shouldAskQuestion',
          'communication.stageOfChange',
        ],
        dependencyIds: [DECISION_ID.RESPOND_TO_MEAL],
        conflictingIds: [DECISION_ID.CLOSE_WITHOUT_QUESTION],
        rationale: 'QUESTION_IS_A_CONVERSATIONAL_OPTION',
      }),
      this.candidate({
        id: DECISION_ID.CLOSE_WITHOUT_QUESTION,
        origin: ORIGIN.COMMUNICATION,
        category: 'CLOSURE',
        intrinsicPriority: 'P2',
        factIds: ['communication.shouldAskQuestion'],
        dependencyIds: [DECISION_ID.RESPOND_TO_MEAL],
        conflictingIds: [DECISION_ID.ASK_QUESTION],
        rationale: 'CLOSURE_IS_A_CONVERSATIONAL_OPTION',
      }),
    );
    if (context.communication.prefersShortMessages) {
      candidates.push(
        this.candidate({
          id: DECISION_ID.RESPOND_BRIEFLY,
          origin: ORIGIN.COMMUNICATION,
          category: 'PRESENTATION',
          intrinsicPriority: 'P2',
          factIds: [
            'communication.prefersShortMessages',
            'communication.preferredMessageLength',
          ],
          rationale: 'SHORT_MESSAGE_PREFERENCE_ACTIVE',
        }),
      );
    }

    if (context.communication.fatigue.score >= 70) {
      candidates.push(
        this.candidate({
          id: DECISION_ID.REDUCE_CONVERSATIONAL_LOAD,
          origin: ORIGIN.COMMUNICATION,
          category: 'PRESENTATION',
          intrinsicPriority: 'P1',
          factIds: ['communication.fatigue'],
          conflictingIds: [DECISION_ID.ASK_QUESTION],
          rationale: 'HIGH_CONVERSATIONAL_FATIGUE',
        }),
      );
    }

    if (context.communication.idealEmojiCount > 0) {
      candidates.push(
        this.candidate({
          id: DECISION_ID.USE_EMOJI,
          origin: ORIGIN.COMMUNICATION,
          category: 'PRESENTATION',
          intrinsicPriority: 'P4',
          factIds: ['communication.idealEmojiCount'],
          rationale: 'CONTEXT_ALLOWS_EMOJI',
        }),
      );
    }

    return Object.freeze(candidates);
  }

  private addNumericFactCandidate(
    candidates: DecisionCandidate[],
    value: number | null,
    id: ConversationDecisionId,
    factId: AuthorizedFactId,
    rationale: string,
  ): void {
    if (value === null) {
      return;
    }

    candidates.push(
      this.candidate({
        id,
        origin: ORIGIN.FACTS,
        category: 'EDUCATION',
        intrinsicPriority: 'P3',
        factIds: [factId],
        dependencyIds: [DECISION_ID.RESPOND_TO_MEAL],
        rationale,
      }),
    );
  }

  private hasImprovement(context: NutritionConversationContext): boolean {
    return (
      context.userContext.trend?.direction === 'IMPROVING' ||
      context.userContext.longitudinalSignal?.direction === 'IMPROVING'
    );
  }

  private improvementFactIds(
    context: NutritionConversationContext,
  ): readonly AuthorizedFactId[] {
    return Object.freeze([
      ...(context.userContext.trend?.direction === 'IMPROVING'
        ? ['userContext.trend']
        : []),
      ...(context.userContext.longitudinalSignal?.direction === 'IMPROVING'
        ? ['userContext.longitudinalSignal']
        : []),
    ]);
  }

  private candidate(definition: CandidateDefinition): DecisionCandidate {
    return Object.freeze({
      id: definition.id,
      code: definition.origin,
      category: definition.category,
      intrinsicPriority: definition.intrinsicPriority,
      required: definition.required ?? false,
      prohibited: false,
      factIds: Object.freeze([...definition.factIds]),
      dependencyIds: Object.freeze([...(definition.dependencyIds ?? [])]),
      complementaryIds: Object.freeze([...(definition.complementaryIds ?? [])]),
      conflictingIds: Object.freeze([...(definition.conflictingIds ?? [])]),
      objectiveCode: definition.rationale,
    });
  }
}
