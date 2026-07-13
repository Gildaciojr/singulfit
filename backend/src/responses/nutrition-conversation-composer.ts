import type {
  CompositionPlan,
  ConversationBlock,
  ConversationBlockType,
  ConversationDensity,
  ConversationDepth,
  ConversationPresentation,
  ConversationRhythm,
} from './conversation-composition.contract';
import type {
  DecisionPlan,
  SelectedDecision,
} from './conversation-decision.contract';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';

interface BlockDefinition {
  readonly key: string;
  readonly type: ConversationBlockType;
  readonly rank: number;
  readonly decisionIds: readonly string[];
}

const DECISION_BLOCK: Readonly<
  Record<string, Omit<BlockDefinition, 'decisionIds'>>
> = Object.freeze({
  'nutrition.qualify-estimates': {
    key: 'disclaimer',
    type: 'UNCERTAINTY_QUALIFICATION',
    rank: 0,
  },
  'nutrition.acknowledge-meal': {
    key: 'recognition',
    type: 'FACTUAL_ACKNOWLEDGEMENT',
    rank: 10,
  },
  'nutrition.acknowledge-positive': {
    key: 'recognition',
    type: 'FACTUAL_ACKNOWLEDGEMENT',
    rank: 10,
  },
  'nutrition.respond-to-meal': {
    key: 'analysis',
    type: 'PRIMARY_OBSERVATION',
    rank: 20,
  },
  'nutrition.show-calories': {
    key: 'analysis',
    type: 'PRIMARY_OBSERVATION',
    rank: 20,
  },
  'nutrition.show-protein': {
    key: 'analysis',
    type: 'PRIMARY_OBSERVATION',
    rank: 20,
  },
  'nutrition.show-carbohydrates': {
    key: 'analysis',
    type: 'PRIMARY_OBSERVATION',
    rank: 20,
  },
  'nutrition.show-fat': {
    key: 'analysis',
    type: 'PRIMARY_OBSERVATION',
    rank: 20,
  },
  'nutrition.show-quality': {
    key: 'analysis',
    type: 'PRIMARY_OBSERVATION',
    rank: 20,
  },
  'nutrition.mention-insight': {
    key: 'education',
    type: 'NUTRITION_EDUCATION',
    rank: 30,
  },
  'nutrition.correct-limiting-factor': {
    key: 'correction',
    type: 'CORRECTION',
    rank: 40,
  },
  'nutrition.provide-recommendation': {
    key: 'correction',
    type: 'CORRECTION',
    rank: 40,
  },
  'nutrition.mention-goal': {
    key: 'continuity',
    type: 'HISTORICAL_COMPARISON',
    rank: 50,
  },
  'nutrition.compare-history': {
    key: 'continuity',
    type: 'HISTORICAL_COMPARISON',
    rank: 50,
  },
  'nutrition.use-memory': {
    key: 'memory',
    type: 'RELATIONAL_MEMORY',
    rank: 60,
  },
  'nutrition.mention-trend': {
    key: 'longitudinal',
    type: 'TREND',
    rank: 70,
  },
  'nutrition.mention-longitudinal': {
    key: 'longitudinal',
    type: 'TREND',
    rank: 70,
  },
  'nutrition.celebrate-improvement': {
    key: 'motivation',
    type: 'EVIDENCE_BASED_MOTIVATION',
    rank: 80,
  },
  'nutrition.motivate-with-evidence': {
    key: 'motivation',
    type: 'EVIDENCE_BASED_MOTIVATION',
    rank: 80,
  },
  'nutrition.ask-question': {
    key: 'question',
    type: 'CLARIFYING_QUESTION',
    rank: 90,
  },
  'nutrition.close-without-question': {
    key: 'closing',
    type: 'MINIMAL_CLOSURE',
    rank: 100,
  },
});

const PRESENTATION_DECISIONS = new Set([
  'nutrition.respond-briefly',
  'nutrition.reduce-conversational-load',
  'nutrition.use-emoji',
]);

export class NutritionConversationComposer {
  compose(
    context: NutritionConversationContext,
    decisionPlan: DecisionPlan,
  ): CompositionPlan {
    this.validatePlan(context, decisionPlan);

    const maximumLength = this.maximumLength(context, decisionPlan);
    const grouped = this.group(decisionPlan.selectedDecisions);
    const ordered = [...grouped].sort(
      (left, right) =>
        left.rank - right.rank || this.compare(left.key, right.key),
    );
    const blocks = Object.freeze(
      ordered.map((definition, order) =>
        this.block(definition, order, decisionPlan, maximumLength),
      ),
    );
    const question = blocks.find((block) =>
      block.decisionIds.includes('nutrition.ask-question'),
    );
    const closing = blocks.find((block) =>
      block.decisionIds.includes('nutrition.close-without-question'),
    );

    return Object.freeze({
      id: `nutrition-composition:${decisionPlan.id}`,
      decisionPlanId: decisionPlan.id,
      blocks,
      depth: this.depth(context, decisionPlan),
      density: this.density(decisionPlan),
      rhythm: this.rhythm(context, decisionPlan),
      presentation: this.presentation(context, blocks),
      paragraphCount: blocks.length,
      maximumLength,
      emojiAllowed: decisionPlan.selectedDecisions.some(
        (decision) => decision.candidateId === 'nutrition.use-emoji',
      ),
      maximumEmojiCount: decisionPlan.selectedDecisions.some(
        (decision) => decision.candidateId === 'nutrition.use-emoji',
      )
        ? context.communication.idealEmojiCount
        : 0,
      ...(question ? { questionBlockId: question.id } : {}),
      ...(closing ? { closingBlockId: closing.id } : {}),
    });
  }

  private validatePlan(
    context: NutritionConversationContext,
    plan: DecisionPlan,
  ): void {
    const selectedIds = new Set(
      plan.selectedDecisions.map((decision) => decision.candidateId),
    );
    if (!selectedIds.has(plan.primaryDecisionId)) {
      throw new Error('DecisionPlan sem decisão central selecionada');
    }
    if (selectedIds.size !== plan.selectedDecisions.length) {
      throw new Error('DecisionPlan contém decisões selecionadas duplicadas');
    }
    if (
      context.policies.requiresEstimateQualification &&
      !selectedIds.has('nutrition.qualify-estimates')
    ) {
      throw new Error(
        'DecisionPlan sem qualificação obrigatória de estimativas',
      );
    }
    if (
      selectedIds.has('nutrition.ask-question') &&
      plan.selectedDecisions.every(
        (decision) =>
          decision.candidateId === 'nutrition.ask-question' ||
          PRESENTATION_DECISIONS.has(decision.candidateId),
      )
    ) {
      throw new Error('Pergunta sem bloco comunicativo anterior');
    }
  }

  private group(
    decisions: readonly SelectedDecision[],
  ): readonly BlockDefinition[] {
    const groups = new Map<string, BlockDefinition>();
    const selectedIds = new Set(
      decisions.map((decision) => decision.candidateId),
    );

    for (const decision of decisions) {
      if (PRESENTATION_DECISIONS.has(decision.candidateId)) continue;
      const defaultMapping = DECISION_BLOCK[decision.candidateId];
      const mapping =
        defaultMapping?.key === 'motivation'
          ? this.motivationSupportMapping(selectedIds)
          : defaultMapping;
      if (!mapping) {
        throw new Error(
          `Decisão sem mapeamento estrutural: ${decision.candidateId}`,
        );
      }
      const current = groups.get(mapping.key);
      groups.set(
        mapping.key,
        Object.freeze({
          ...mapping,
          decisionIds: Object.freeze([
            ...(current?.decisionIds ?? []),
            decision.candidateId,
          ]),
        }),
      );
    }

    return Object.freeze([...groups.values()]);
  }

  private motivationSupportMapping(
    selectedIds: ReadonlySet<string>,
  ): Omit<BlockDefinition, 'decisionIds'> {
    if (
      selectedIds.has('nutrition.correct-limiting-factor') ||
      selectedIds.has('nutrition.provide-recommendation')
    ) {
      return { key: 'correction', type: 'CORRECTION', rank: 40 };
    }
    if (
      selectedIds.has('nutrition.acknowledge-meal') ||
      selectedIds.has('nutrition.acknowledge-positive')
    ) {
      return {
        key: 'recognition',
        type: 'FACTUAL_ACKNOWLEDGEMENT',
        rank: 10,
      };
    }
    throw new Error('Motivação sem decisão estrutural de apoio');
  }
  private block(
    definition: BlockDefinition,
    order: number,
    plan: DecisionPlan,
    maximumLength: number,
  ): ConversationBlock {
    const selectedById = new Map(
      plan.selectedDecisions.map((decision) => [
        decision.candidateId,
        decision,
      ]),
    );
    const factIds = Object.freeze([
      ...new Set(
        definition.decisionIds.flatMap(
          (decisionId) => selectedById.get(decisionId)?.factIds ?? [],
        ),
      ),
    ]);
    const required = definition.decisionIds.some((decisionId) =>
      plan.mandatoryDecisionIds.includes(decisionId),
    );

    return Object.freeze({
      id: `${plan.id}:block:${order + 1}`,
      type: definition.type,
      decisionIds: Object.freeze([...definition.decisionIds]),
      factIds,
      order,
      paragraph: order,
      presentation:
        definition.key === 'analysis' && definition.decisionIds.length >= 3
          ? 'BULLETS'
          : 'PROSE',
      required,
      maximumLength: Math.max(
        40,
        Math.floor(
          maximumLength /
            Math.max(1, this.group(plan.selectedDecisions).length),
        ),
      ),
    });
  }

  private maximumLength(
    context: NutritionConversationContext,
    plan: DecisionPlan,
  ): number {
    const preferred = Math.max(
      160,
      context.communication.preferredMessageLength,
    );
    const cap = plan.maximumCommunicativeDecisions <= 2 ? 400 : 1_200;
    return Math.min(preferred, cap);
  }

  private depth(
    context: NutritionConversationContext,
    plan: DecisionPlan,
  ): ConversationDepth {
    if (
      context.communication.prefersShortMessages ||
      context.communication.fatigue.score >= 70 ||
      plan.maximumCommunicativeDecisions <= 2
    )
      return 'MINIMAL';
    if (
      plan.maximumCommunicativeDecisions >= 5 &&
      context.communication.preferredMessageLength >= 800
    )
      return 'DEEP';
    return 'MODERATE';
  }

  private density(plan: DecisionPlan): ConversationDensity {
    const selected = plan.selectedDecisions.filter(
      (decision) => !PRESENTATION_DECISIONS.has(decision.candidateId),
    );
    const facts = new Set(selected.flatMap((decision) => decision.factIds));
    if (selected.length <= 2 && facts.size <= 3) return 'LOW';
    if (selected.length >= 5 || facts.size >= 8) return 'HIGH';
    return 'MEDIUM';
  }

  private rhythm(
    context: NutritionConversationContext,
    plan: DecisionPlan,
  ): ConversationRhythm {
    if (
      context.communication.prefersShortMessages ||
      context.communication.fatigue.score >= 70 ||
      plan.maximumCommunicativeDecisions <= 2
    )
      return 'FAST';
    if (
      plan.selectedDecisions.some((decision) =>
        [
          'nutrition.mention-insight',
          'nutrition.correct-limiting-factor',
          'nutrition.provide-recommendation',
        ].includes(decision.candidateId),
      )
    )
      return 'EXPLANATORY';
    return 'PROGRESSIVE';
  }

  private presentation(
    context: NutritionConversationContext,
    blocks: readonly ConversationBlock[],
  ): ConversationPresentation {
    if (context.communication.prefersShortMessages) return 'PROSE';
    return blocks.some((block) => block.presentation === 'BULLETS')
      ? 'BULLETS'
      : 'PROSE';
  }

  private compare(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
  }
}
