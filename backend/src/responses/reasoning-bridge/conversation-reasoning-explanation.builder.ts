import type {
  ConversationReasoningExplanationEvidence,
  ConversationReasoningPriorityEvidence,
  ConversationReasoningSafetyEvidence,
  ConversationReasoningStrategyEvidence,
  ConversationReasoningSummary,
  ConversationReasoningTradeoffEvidence,
} from './conversation-reasoning-bridge.contract';

export class ConversationReasoningExplanationBuilder {
  build(input: {
    readonly summary: ConversationReasoningSummary;
    readonly priorities: readonly ConversationReasoningPriorityEvidence[];
    readonly strategies: readonly ConversationReasoningStrategyEvidence[];
    readonly tradeoffs: readonly ConversationReasoningTradeoffEvidence[];
    readonly safety: ConversationReasoningSafetyEvidence;
  }): readonly ConversationReasoningExplanationEvidence[] {
    const explanations: ConversationReasoningExplanationEvidence[] = [];
    const primaryPriority = input.priorities[0];
    const primaryStrategy = input.strategies[0];
    if (input.summary.decision && primaryPriority) {
      explanations.push({
        point: input.summary.decision,
        because: primaryPriority.explanation,
        benefit:
          input.summary.expectedBenefit ??
          'manter a orientação coerente com o contexto atual',
        avoidedRisk: input.safety.requiresCaution
          ? 'evitar uma orientação incompatível com os limites atuais'
          : null,
      });
    }
    if (primaryStrategy) {
      explanations.push({
        point: primaryStrategy.name,
        because: `Essa escolha ajuda a ${primaryStrategy.purpose}.`,
        benefit: primaryStrategy.purpose,
        avoidedRisk: null,
      });
    }
    for (const tradeoff of input.tradeoffs.slice(0, 2)) {
      explanations.push({
        point: tradeoff.preferred,
        because: tradeoff.explanation,
        benefit: `preservar ${tradeoff.preferred}`,
        avoidedRisk: `dar prioridade a ${tradeoff.deprioritized}`,
      });
    }
    return Object.freeze(
      explanations.slice(0, 4).map((item) => Object.freeze(item)),
    );
  }
}
