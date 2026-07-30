import type {
  ConversationBlockType,
  ConversationCentralIntent,
  ConversationDialogueProfile,
  ConversationDialogueProfileDefinition,
} from './conversation-composition.contract';
import type {
  ConversationDecisionCategory,
  SelectedDecision,
} from './conversation-decision.contract';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';

const BASE_BLOCKS: readonly ConversationBlockType[] = Object.freeze([
  'UNCERTAINTY_QUALIFICATION',
  'FACTUAL_ACKNOWLEDGEMENT',
  'PRIMARY_OBSERVATION',
  'MINIMAL_CLOSURE',
]);

function definition(
  profile: ConversationDialogueProfile,
  centralIntent: ConversationCentralIntent,
  input: Omit<
    ConversationDialogueProfileDefinition,
    'profile' | 'centralIntent'
  >,
): ConversationDialogueProfileDefinition {
  return Object.freeze({
    profile,
    centralIntent,
    allowedBlocks: Object.freeze([...input.allowedBlocks]),
    prohibitedBlocks: Object.freeze([...input.prohibitedBlocks]),
    depth: input.depth,
    density: input.density,
    rhythm: input.rhythm,
    budgets: Object.freeze({ ...input.budgets }),
    emojiAllowed: input.emojiAllowed,
    closingRequirement: input.closingRequirement,
    eligibilityCodes: Object.freeze([...input.eligibilityCodes]),
  });
}

const PROFILES: Readonly<
  Record<ConversationDialogueProfile, ConversationDialogueProfileDefinition>
> = Object.freeze({
  ACKNOWLEDGE_ONLY: definition('ACKNOWLEDGE_ONLY', 'RECOGNIZE', {
    allowedBlocks: BASE_BLOCKS,
    prohibitedBlocks: [
      'CORRECTION',
      'NUTRITION_EDUCATION',
      'CLARIFYING_QUESTION',
    ],
    depth: 'BRIEF',
    density: 'LOW',
    rhythm: 'WARM',
    budgets: {
      maximumPerceptibleDecisions: 2,
      maximumFactCount: 5,
      maximumBlockCount: 3,
      maximumParagraphCount: 2,
      maximumQuestions: 0,
      maximumActions: 0,
      maximumEmojiCount: 1,
      maximumLength: 360,
    },
    emojiAllowed: true,
    closingRequirement: 'OPTIONAL',
    eligibilityCodes: ['POSITIVE_OR_SUFFICIENT_FACT', 'NO_RELEVANT_CORRECTION'],
  }),
  ACKNOWLEDGE_AND_ADJUST: definition('ACKNOWLEDGE_AND_ADJUST', 'ADJUST', {
    allowedBlocks: [...BASE_BLOCKS, 'CORRECTION'],
    prohibitedBlocks: ['NUTRITION_EDUCATION', 'CLARIFYING_QUESTION'],
    depth: 'MODERATE',
    density: 'MEDIUM',
    rhythm: 'PROGRESSIVE',
    budgets: {
      maximumPerceptibleDecisions: 3,
      maximumFactCount: 7,
      maximumBlockCount: 4,
      maximumParagraphCount: 3,
      maximumQuestions: 0,
      maximumActions: 1,
      maximumEmojiCount: 1,
      maximumLength: 560,
    },
    emojiAllowed: true,
    closingRequirement: 'OPTIONAL',
    eligibilityCodes: ['POSITIVE_EVIDENCE', 'SINGLE_RELEVANT_ADJUSTMENT'],
  }),
  REFLECT_AND_ASK: definition('REFLECT_AND_ASK', 'CLARIFY', {
    allowedBlocks: [...BASE_BLOCKS, 'CORRECTION', 'CLARIFYING_QUESTION'],
    prohibitedBlocks: ['NUTRITION_EDUCATION', 'EVIDENCE_BASED_MOTIVATION'],
    depth: 'BRIEF',
    density: 'LOW',
    rhythm: 'DELIBERATIVE',
    budgets: {
      maximumPerceptibleDecisions: 3,
      maximumFactCount: 6,
      maximumBlockCount: 4,
      maximumParagraphCount: 3,
      maximumQuestions: 1,
      maximumActions: 0,
      maximumEmojiCount: 0,
      maximumLength: 480,
    },
    emojiAllowed: false,
    closingRequirement: 'PROHIBITED',
    eligibilityCodes: ['UNRESOLVED_BARRIER', 'USEFUL_QUESTION', 'LOW_FATIGUE'],
  }),
  TEACH_BRIEFLY: definition('TEACH_BRIEFLY', 'TEACH', {
    allowedBlocks: [...BASE_BLOCKS, 'NUTRITION_EDUCATION'],
    prohibitedBlocks: [
      'CORRECTION',
      'CLARIFYING_QUESTION',
      'EVIDENCE_BASED_MOTIVATION',
    ],
    depth: 'BRIEF',
    density: 'MEDIUM',
    rhythm: 'EXPLANATORY',
    budgets: {
      maximumPerceptibleDecisions: 3,
      maximumFactCount: 7,
      maximumBlockCount: 4,
      maximumParagraphCount: 3,
      maximumQuestions: 0,
      maximumActions: 0,
      maximumEmojiCount: 0,
      maximumLength: 520,
    },
    emojiAllowed: false,
    closingRequirement: 'OPTIONAL',
    eligibilityCodes: [
      'SPECIFIC_QUESTION_OR_CURIOSITY',
      'SHORT_EXPLANATION_SUFFICIENT',
    ],
  }),
  RECOVERY: definition('RECOVERY', 'RECOVER', {
    allowedBlocks: [
      ...BASE_BLOCKS,
      'CORRECTION',
      'HISTORICAL_COMPARISON',
      'TREND',
    ],
    prohibitedBlocks: ['NUTRITION_EDUCATION', 'EVIDENCE_BASED_MOTIVATION'],
    depth: 'BRIEF',
    density: 'LOW',
    rhythm: 'WARM',
    budgets: {
      maximumPerceptibleDecisions: 3,
      maximumFactCount: 7,
      maximumBlockCount: 4,
      maximumParagraphCount: 3,
      maximumQuestions: 0,
      maximumActions: 1,
      maximumEmojiCount: 0,
      maximumLength: 480,
    },
    emojiAllowed: false,
    closingRequirement: 'OPTIONAL',
    eligibilityCodes: [
      'RECOVERY_OR_REENGAGEMENT_EVIDENCE',
      'MINIMAL_NEXT_ACTION',
    ],
  }),
  CELEBRATE: definition('CELEBRATE', 'CELEBRATE', {
    allowedBlocks: [...BASE_BLOCKS, 'TREND'],
    prohibitedBlocks: [
      'CORRECTION',
      'NUTRITION_EDUCATION',
      'CLARIFYING_QUESTION',
    ],
    depth: 'BRIEF',
    density: 'LOW',
    rhythm: 'WARM',
    budgets: {
      maximumPerceptibleDecisions: 2,
      maximumFactCount: 5,
      maximumBlockCount: 3,
      maximumParagraphCount: 2,
      maximumQuestions: 0,
      maximumActions: 0,
      maximumEmojiCount: 1,
      maximumLength: 380,
    },
    emojiAllowed: true,
    closingRequirement: 'OPTIONAL',
    eligibilityCodes: ['RELEVANT_WIN', 'NO_IMPORTANT_CORRECTION'],
  }),
  DETAILED_ANALYSIS: definition('DETAILED_ANALYSIS', 'ANALYZE', {
    allowedBlocks: [
      'UNCERTAINTY_QUALIFICATION',
      'FACTUAL_ACKNOWLEDGEMENT',
      'PRIMARY_OBSERVATION',
      'NUTRITION_EDUCATION',
      'CORRECTION',
      'HISTORICAL_COMPARISON',
      'RELATIONAL_MEMORY',
      'TREND',
      'CLARIFYING_QUESTION',
      'MINIMAL_CLOSURE',
    ],
    prohibitedBlocks: [],
    depth: 'DEEP',
    density: 'HIGH',
    rhythm: 'EXPLANATORY',
    budgets: {
      maximumPerceptibleDecisions: 6,
      maximumFactCount: 14,
      maximumBlockCount: 7,
      maximumParagraphCount: 6,
      maximumQuestions: 1,
      maximumActions: 1,
      maximumEmojiCount: 1,
      maximumLength: 1200,
    },
    emojiAllowed: true,
    closingRequirement: 'OPTIONAL',
    eligibilityCodes: [
      'EXPLICIT_DETAIL_REQUEST',
      'LEGITIMATE_COMPLEXITY',
      'CAPACITY_AVAILABLE',
    ],
  }),
  CLARIFY_BEFORE_ANALYSIS: definition('CLARIFY_BEFORE_ANALYSIS', 'CLARIFY', {
    allowedBlocks: [
      'UNCERTAINTY_QUALIFICATION',
      'PRIMARY_OBSERVATION',
      'CLARIFYING_QUESTION',
    ],
    prohibitedBlocks: [
      'CORRECTION',
      'NUTRITION_EDUCATION',
      'HISTORICAL_COMPARISON',
      'TREND',
      'EVIDENCE_BASED_MOTIVATION',
    ],
    depth: 'MINIMAL',
    density: 'LOW',
    rhythm: 'FAST',
    budgets: {
      maximumPerceptibleDecisions: 2,
      maximumFactCount: 4,
      maximumBlockCount: 3,
      maximumParagraphCount: 2,
      maximumQuestions: 1,
      maximumActions: 0,
      maximumEmojiCount: 0,
      maximumLength: 320,
    },
    emojiAllowed: false,
    closingRequirement: 'PROHIBITED',
    eligibilityCodes: [
      'LOW_CONFIDENCE_OR_MISSING_ESSENTIAL_FACT',
      'QUESTION_PRECEDES_ANALYSIS',
    ],
  }),
  REASSURE_AND_SIMPLIFY: definition('REASSURE_AND_SIMPLIFY', 'REASSURE', {
    allowedBlocks: [...BASE_BLOCKS, 'CORRECTION', 'TREND'],
    prohibitedBlocks: [
      'NUTRITION_EDUCATION',
      'CLARIFYING_QUESTION',
      'EVIDENCE_BASED_MOTIVATION',
    ],
    depth: 'MINIMAL',
    density: 'LOW',
    rhythm: 'WARM',
    budgets: {
      maximumPerceptibleDecisions: 2,
      maximumFactCount: 5,
      maximumBlockCount: 3,
      maximumParagraphCount: 3,
      maximumQuestions: 0,
      maximumActions: 1,
      maximumEmojiCount: 0,
      maximumLength: 400,
    },
    emojiAllowed: false,
    closingRequirement: 'REQUIRED',
    eligibilityCodes: [
      'FATIGUE_OVERWHELM_OR_FRUSTRATION',
      'REDUCED_COGNITIVE_LOAD',
    ],
  }),
  CONTINUITY_CHECK: definition('CONTINUITY_CHECK', 'FOLLOW_UP', {
    allowedBlocks: [
      ...BASE_BLOCKS,
      'HISTORICAL_COMPARISON',
      'RELATIONAL_MEMORY',
      'TREND',
      'CLARIFYING_QUESTION',
    ],
    prohibitedBlocks: ['NUTRITION_EDUCATION', 'EVIDENCE_BASED_MOTIVATION'],
    depth: 'BRIEF',
    density: 'LOW',
    rhythm: 'PROGRESSIVE',
    budgets: {
      maximumPerceptibleDecisions: 3,
      maximumFactCount: 7,
      maximumBlockCount: 4,
      maximumParagraphCount: 3,
      maximumQuestions: 1,
      maximumActions: 0,
      maximumEmojiCount: 0,
      maximumLength: 460,
    },
    emojiAllowed: false,
    closingRequirement: 'PROHIBITED',
    eligibilityCodes: ['RELEVANT_PRIOR_COMMITMENT', 'NON_REPETITIVE_FOLLOW_UP'],
  }),
});

export interface NutritionDialogueProfileSelection {
  readonly profile: ConversationDialogueProfile;
  readonly centralIntent: ConversationCentralIntent;
  readonly definition: ConversationDialogueProfileDefinition;
}

export class NutritionConversationDialogueProfilePolicy {
  select(
    context: NutritionConversationContext,
    selectedDecisions: readonly SelectedDecision[],
  ): NutritionDialogueProfileSelection {
    const selected = new Set(selectedDecisions.map((item) => item.candidateId));
    const recognition = new Set<string>(
      (context.recognition?.signals ?? []).map((signal) => signal.kind),
    );
    const emotional = new Set<string>(
      (context.emotional?.signals ?? []).map((signal) => signal.kind),
    );
    const lowConfidence =
      context.dialogue?.clarificationRequired === true ||
      context.facts.foods.length === 0 ||
      (context.facts.confidence !== undefined &&
        context.facts.confidence < 0.7) ||
      emotional.has('UNCERTAINTY');
    const fatigued = context.communication.fatigue.score >= 70;
    const correction =
      selected.has('nutrition.provide-recommendation') ||
      selected.has('nutrition.correct-limiting-factor') ||
      context.direction.supportingEvidence.limitingFactors.length > 0;
    const positive =
      context.direction.supportingEvidence.positiveFactors.length > 0 ||
      [
        'EFFORT',
        'CONSISTENCY',
        'SMALL_WIN',
        'BIG_WIN',
        'GOOD_DECISION',
        'IMPROVEMENT',
      ].some((kind) => recognition.has(kind));
    const recovery =
      ['RECOVERY', 'RECURRENCE', 'BAD_STRATEGY'].some((kind) =>
        recognition.has(kind),
      ) || ['REENGAGEMENT', 'RESISTANCE'].some((kind) => emotional.has(kind));
    const overloaded =
      fatigued ||
      ['OVERWHELM', 'FATIGUE', 'FRUSTRATION'].some((kind) =>
        emotional.has(kind),
      );
    const detailedEligible =
      context.dialogue?.explicitDetailRequest === true &&
      !fatigued &&
      context.communication.preferredMessageLength >= 800 &&
      (context.facts.foods.length >= 3 ||
        this.availableFactCount(context) >= 7);
    const continuityEligible =
      ((context.dialogue?.previousCommitmentAvailable === true &&
        context.userContext.memory !== undefined) ||
        (context.dialogue?.interactionIntent === 'FOLLOW_UP' &&
          (context.episodicMemory?.episodes.length ?? 0) > 0)) &&
      !fatigued;
    const relevantWin =
      ['BIG_WIN', 'SMALL_WIN', 'IMPROVEMENT'].some((kind) =>
        recognition.has(kind),
      ) || emotional.has('SATISFACTION');
    const usefulQuestion =
      !fatigued &&
      (context.communication.shouldAskQuestion ||
        lowConfidence ||
        context.dialogue?.specificQuestion === true);

    let profile: ConversationDialogueProfile;
    if (lowConfidence && usefulQuestion) profile = 'CLARIFY_BEFORE_ANALYSIS';
    else if (recovery) profile = 'RECOVERY';
    else if (overloaded) profile = 'REASSURE_AND_SIMPLIFY';
    else if (detailedEligible) profile = 'DETAILED_ANALYSIS';
    else if (continuityEligible) profile = 'CONTINUITY_CHECK';
    else if (relevantWin && !correction) profile = 'CELEBRATE';
    else if (selected.has('nutrition.ask-question') && usefulQuestion)
      profile = 'REFLECT_AND_ASK';
    else if (
      correction &&
      usefulQuestion &&
      !context.direction.authorizedRecommendation
    )
      profile = 'REFLECT_AND_ASK';
    else if (
      context.dialogue?.specificQuestion === true ||
      emotional.has('CURIOSITY')
    )
      profile = 'TEACH_BRIEFLY';
    else if (positive && correction) profile = 'ACKNOWLEDGE_AND_ADJUST';
    else if (positive && !correction) profile = 'ACKNOWLEDGE_ONLY';
    else if (correction) profile = 'ACKNOWLEDGE_AND_ADJUST';
    else profile = 'ACKNOWLEDGE_ONLY';

    const selectedProfile = PROFILES[profile];
    return Object.freeze({
      profile,
      centralIntent: selectedProfile.centralIntent,
      definition: selectedProfile,
    });
  }

  definition(
    profile: ConversationDialogueProfile,
  ): ConversationDialogueProfileDefinition {
    return PROFILES[profile];
  }

  allowsDecision(
    profile: ConversationDialogueProfile,
    candidateId: string,
    category: ConversationDecisionCategory,
  ): boolean {
    if (candidateId === 'nutrition.ask-question') {
      return PROFILES[profile].budgets.maximumQuestions > 0;
    }
    if (candidateId === 'nutrition.close-without-question') {
      return PROFILES[profile].closingRequirement !== 'PROHIBITED';
    }
    if (
      [
        'nutrition.provide-recommendation',
        'nutrition.correct-limiting-factor',
      ].includes(candidateId)
    ) {
      return PROFILES[profile].budgets.maximumActions > 0;
    }
    if (candidateId === 'nutrition.detail-analysis') {
      return profile === 'DETAILED_ANALYSIS';
    }
    if (candidateId === 'nutrition.clarify-before-analysis') {
      return profile === 'CLARIFY_BEFORE_ANALYSIS';
    }
    if (candidateId === 'nutrition.teach-briefly') {
      return profile === 'TEACH_BRIEFLY' || profile === 'DETAILED_ANALYSIS';
    }
    if (candidateId === 'nutrition.follow-up-commitment') {
      return profile === 'CONTINUITY_CHECK';
    }
    if (category === 'CURIOSITY') {
      return PROFILES[profile].budgets.maximumQuestions > 0;
    }
    if (category === 'MEMORY') {
      return ['RECOVERY', 'CONTINUITY_CHECK', 'DETAILED_ANALYSIS'].includes(
        profile,
      );
    }
    if (category === 'CELEBRATION') return profile === 'CELEBRATE';
    if (category === 'MOTIVATION') {
      return ['RECOVERY', 'CELEBRATE'].includes(profile);
    }
    if (category === 'EMPATHY') {
      return ['RECOVERY', 'REASSURE_AND_SIMPLIFY', 'REFLECT_AND_ASK'].includes(
        profile,
      );
    }
    return true;
  }

  private availableFactCount(context: NutritionConversationContext): number {
    return [
      context.facts.foods.length > 0,
      context.facts.totalCalories !== null,
      context.facts.totalProtein !== null,
      context.facts.totalCarbs !== null,
      context.facts.totalFat !== null,
      context.facts.qualityScore !== null,
      context.userContext.trend !== undefined,
      context.userContext.longitudinalSignal !== undefined,
      context.direction.authorizedRecommendation !== undefined,
    ].filter(Boolean).length;
  }
}
