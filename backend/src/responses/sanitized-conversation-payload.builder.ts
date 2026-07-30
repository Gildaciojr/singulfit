import type { AuthorizedFacts } from './conversation-authorized-facts.contract';
import type { CompositionPlan } from './conversation-composition.contract';
import type { DecisionPlan } from './conversation-decision.contract';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';
import { NutritionConversationCoachStyleEngine } from './nutrition-conversation-coach-style.engine';
import type {
  SanitizedConversationBlock,
  SanitizedConversationDecision,
  SanitizedConversationFact,
  SanitizedConversationPayload,
} from './sanitized-conversation-payload.contract';

const SEMANTIC_DECISION: Readonly<
  Record<string, SanitizedConversationDecision>
> = Object.freeze({
  'nutrition.respond-to-meal': 'RESPOND_TO_MEAL',
  'nutrition.qualify-estimates': 'QUALIFY_ESTIMATES',
  'nutrition.acknowledge-meal': 'ACKNOWLEDGE_MEAL',
  'nutrition.show-calories': 'SHOW_CALORIES',
  'nutrition.show-protein': 'SHOW_PROTEIN',
  'nutrition.show-carbohydrates': 'SHOW_CARBOHYDRATES',
  'nutrition.show-fat': 'SHOW_FAT',
  'nutrition.show-quality': 'SHOW_QUALITY',
  'nutrition.mention-goal': 'MENTION_GOAL',
  'nutrition.use-memory': 'USE_MEMORY',
  'nutrition.compare-history': 'COMPARE_HISTORY',
  'nutrition.mention-insight': 'MENTION_INSIGHT',
  'nutrition.mention-trend': 'MENTION_TREND',
  'nutrition.mention-longitudinal': 'MENTION_LONGITUDINAL',
  'nutrition.provide-recommendation': 'PROVIDE_RECOMMENDATION',
  'nutrition.acknowledge-positive': 'ACKNOWLEDGE_POSITIVE',
  'nutrition.correct-limiting-factor': 'CORRECT_LIMITING_FACTOR',
  'nutrition.celebrate-improvement': 'CELEBRATE_IMPROVEMENT',
  'nutrition.motivate-with-evidence': 'MOTIVATE_WITH_EVIDENCE',
  'nutrition.ask-question': 'ASK_QUESTION',
  'nutrition.close-without-question': 'CLOSE_WITHOUT_QUESTION',
  'nutrition.respond-briefly': 'RESPOND_BRIEFLY',
  'nutrition.reduce-conversational-load': 'REDUCE_CONVERSATIONAL_LOAD',
  'nutrition.use-emoji': 'USE_EMOJI',
  'nutrition.acknowledge-effort': 'ACKNOWLEDGE_EFFORT',
  'nutrition.acknowledge-progress': 'ACKNOWLEDGE_PROGRESS',
  'nutrition.acknowledge-recovery': 'ACKNOWLEDGE_RECOVERY',
  'nutrition.acknowledge-small-win': 'ACKNOWLEDGE_SMALL_WIN',
  'nutrition.acknowledge-consistency': 'ACKNOWLEDGE_CONSISTENCY',
  'nutrition.acknowledge-strategy': 'ACKNOWLEDGE_STRATEGY',
  'nutrition.acknowledge-discipline': 'ACKNOWLEDGE_DISCIPLINE',
  'nutrition.acknowledge-improvement': 'ACKNOWLEDGE_IMPROVEMENT',
  'nutrition.validate-frustration': 'VALIDATE_FRUSTRATION',
  'nutrition.reinforce-confidence': 'REINFORCE_CONFIDENCE',
  'nutrition.reduce-cognitive-load': 'REDUCE_COGNITIVE_LOAD',
  'nutrition.normalize-setback': 'NORMALIZE_SETBACK',
  'nutrition.simplify-guidance': 'SIMPLIFY_GUIDANCE',
  'nutrition.encourage-continuity': 'ENCOURAGE_CONTINUITY',
  'nutrition.answer-curiosity': 'ANSWER_CURIOSITY',
  'nutrition.clarify-before-analysis': 'CLARIFY_BEFORE_ANALYSIS',
  'nutrition.teach-briefly': 'TEACH_BRIEFLY',
  'nutrition.detail-analysis': 'DETAIL_ANALYSIS',
  'nutrition.follow-up-commitment': 'FOLLOW_UP_COMMITMENT',
  'nutrition.follow-up-episode': 'FOLLOW_UP_EPISODE',
  'nutrition.continue-strategy': 'CONTINUE_STRATEGY',
  'nutrition.check-commitment': 'CHECK_COMMITMENT',
  'nutrition.recall-success': 'RECALL_SUCCESS',
  'nutrition.recall-setback': 'RECALL_SETBACK',
  'nutrition.recall-difficulty': 'RECALL_DIFFICULTY',
  'nutrition.recall-goal': 'RECALL_GOAL',
});

export interface BuildSanitizedConversationPayloadInput {
  readonly context: NutritionConversationContext;
  readonly authorizedFacts: AuthorizedFacts;
  readonly decisionPlan: DecisionPlan;
  readonly compositionPlan: CompositionPlan;
}

export class SanitizedConversationPayloadBuilder {
  private readonly coachStyleEngine =
    new NutritionConversationCoachStyleEngine();

  build(
    input: BuildSanitizedConversationPayloadInput,
  ): SanitizedConversationPayload {
    const availableFacts = new Set([
      ...input.authorizedFacts.allowed.map((fact) => fact.id),
      ...input.authorizedFacts.sensitive.map((fact) => fact.id),
    ]);
    const selectedDecisions = Object.freeze(
      input.decisionPlan.selectedDecisions.map((decision) =>
        this.semanticDecision(decision.candidateId),
      ),
    );
    const blocks = Object.freeze(
      input.compositionPlan.blocks.map((block) => {
        for (const fact of block.factIds) {
          if (!availableFacts.has(fact)) {
            throw new Error(`Fato não autorizado na composição: ${fact}`);
          }
        }
        return Object.freeze({
          key: this.blockKey(block.order, block.type),
          type: block.type,
          decisions: Object.freeze(
            block.decisionIds.map((decision) =>
              this.semanticDecision(decision),
            ),
          ),
          facts: Object.freeze([...block.factIds]),
          order: block.order,
          paragraph: block.paragraph,
          presentation: block.presentation,
          required: block.required,
          maximumLength: block.maximumLength,
        }) satisfies SanitizedConversationBlock;
      }),
    );

    return Object.freeze({
      facts: Object.freeze({
        allowed: Object.freeze(
          input.authorizedFacts.allowed.map((fact) => this.sanitizedFact(fact)),
        ),
        sensitive: Object.freeze(
          input.authorizedFacts.sensitive.map((fact) =>
            this.sanitizedFact(fact),
          ),
        ),
        disclaimerRequired: input.authorizedFacts.disclaimerRequired,
      }),
      selectedDecisions,
      structure: Object.freeze({
        dialogueProfile: input.compositionPlan.dialogueProfile,
        centralIntent: input.compositionPlan.centralIntent,
        blocks,
        depth: input.compositionPlan.depth,
        density: input.compositionPlan.density,
        rhythm: input.compositionPlan.rhythm,
        presentation: input.compositionPlan.presentation,
        paragraphCount: input.compositionPlan.paragraphCount,
      }),
      style: Object.freeze({
        coach: this.coachStyleEngine.resolve(
          input.context,
          input.compositionPlan,
          selectedDecisions,
        ),
        communication: input.context.communication.communicationStyle,
        coaching: input.context.communication.coachingStyle,
        tone: input.context.communication.tone,
        motivationFocus: input.context.communication.motivationFocus,
        stageOfChange: input.context.communication.stageOfChange,
      }),
      limits: Object.freeze({
        maximumLength: input.compositionPlan.maximumLength,
        maximumEmojiCount: input.compositionPlan.maximumEmojiCount,
        maximumQuestions: input.decisionPlan.maximumQuestions,
        maximumActions: input.decisionPlan.maximumActions,
        maximumFacts: input.compositionPlan.profileBudgets.maximumFactCount,
        maximumBlocks: input.compositionPlan.profileBudgets.maximumBlockCount,
        maximumParagraphs:
          input.compositionPlan.profileBudgets.maximumParagraphCount,
      }),
      policies: Object.freeze({
        estimateQualificationRequired:
          input.context.policies.requiresEstimateQualification,
        emojiAllowed: input.compositionPlan.emojiAllowed,
        closingRequirement: input.compositionPlan.closingRequirement,
      }),
    });
  }

  private blockKey(order: number, type: string): string {
    return `block-${order + 1}-${type.toLowerCase().replace(/_/g, '-')}`;
  }
  private sanitizedFact(
    fact: AuthorizedFacts['allowed'][number],
  ): SanitizedConversationFact {
    return Object.freeze({
      key: fact.id,
      source: fact.source,
      value: fact.value,
      ...(fact.confidence !== undefined ? { confidence: fact.confidence } : {}),
      estimated: fact.estimated,
    });
  }
  private semanticDecision(value: string): SanitizedConversationDecision {
    const semantic = SEMANTIC_DECISION[value];
    if (!semantic) {
      throw new Error(
        `Decisão não autorizada para payload linguístico: ${value}`,
      );
    }
    return semantic;
  }
}
