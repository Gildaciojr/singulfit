import type { AuthorizedFacts } from './conversation-authorized-facts.contract';
import type { CompositionPlan } from './conversation-composition.contract';
import type { DecisionPlan } from './conversation-decision.contract';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';
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
});

export interface BuildSanitizedConversationPayloadInput {
  readonly context: NutritionConversationContext;
  readonly authorizedFacts: AuthorizedFacts;
  readonly decisionPlan: DecisionPlan;
  readonly compositionPlan: CompositionPlan;
}

export class SanitizedConversationPayloadBuilder {
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
        blocks,
        depth: input.compositionPlan.depth,
        density: input.compositionPlan.density,
        rhythm: input.compositionPlan.rhythm,
        presentation: input.compositionPlan.presentation,
        paragraphCount: input.compositionPlan.paragraphCount,
      }),
      style: Object.freeze({
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
      }),
      policies: Object.freeze({
        estimateQualificationRequired:
          input.context.policies.requiresEstimateQualification,
        emojiAllowed: input.compositionPlan.emojiAllowed,
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
