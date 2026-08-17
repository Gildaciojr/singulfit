import type {
  CompositionPlan,
  ConversationBlock,
  ConversationBlockType,
  ConversationPresentation,
} from './conversation-composition.contract';
import type {
  DecisionPlan,
  SelectedDecision,
} from './conversation-decision.contract';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';
import { NutritionConversationDialogueProfilePolicy } from './nutrition-conversation-dialogue-profile.policy';
import { NutritionConversationFlowPlanner } from './nutrition-conversation-flow-planner';
import type { NutritionConversationFlowPlan } from './nutrition-conversation-planning.contract';

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
  'nutrition.clarify-before-analysis': {
    key: 'disclaimer',
    type: 'UNCERTAINTY_QUALIFICATION',
    rank: 0,
  },
  'nutrition.teach-briefly': {
    key: 'education',
    type: 'NUTRITION_EDUCATION',
    rank: 30,
  },
  'nutrition.detail-analysis': {
    key: 'analysis',
    type: 'PRIMARY_OBSERVATION',
    rank: 20,
  },
  'nutrition.follow-up-commitment': {
    key: 'continuity',
    type: 'HISTORICAL_COMPARISON',
    rank: 50,
  },
  'nutrition.follow-up-episode': {
    key: 'continuity',
    type: 'HISTORICAL_COMPARISON',
    rank: 50,
  },
  'nutrition.continue-strategy': {
    key: 'continuity',
    type: 'HISTORICAL_COMPARISON',
    rank: 50,
  },
  'nutrition.check-commitment': {
    key: 'continuity',
    type: 'HISTORICAL_COMPARISON',
    rank: 50,
  },
  'nutrition.recall-success': {
    key: 'continuity',
    type: 'HISTORICAL_COMPARISON',
    rank: 50,
  },
  'nutrition.recall-setback': {
    key: 'continuity',
    type: 'HISTORICAL_COMPARISON',
    rank: 50,
  },
  'nutrition.recall-difficulty': {
    key: 'continuity',
    type: 'HISTORICAL_COMPARISON',
    rank: 50,
  },
  'nutrition.recall-goal': {
    key: 'continuity',
    type: 'HISTORICAL_COMPARISON',
    rank: 50,
  },
});

const PRESENTATION_DECISIONS = new Set([
  'nutrition.respond-briefly',
  'nutrition.reduce-conversational-load',
  'nutrition.use-emoji',
]);

const RECOGNITION_DECISIONS = new Set([
  'nutrition.acknowledge-effort',
  'nutrition.acknowledge-progress',
  'nutrition.acknowledge-recovery',
  'nutrition.acknowledge-small-win',
  'nutrition.acknowledge-consistency',
  'nutrition.acknowledge-strategy',
  'nutrition.acknowledge-discipline',
  'nutrition.acknowledge-improvement',
]);

const EMOTIONAL_DECISIONS = new Set([
  'nutrition.validate-frustration',
  'nutrition.reinforce-confidence',
  'nutrition.reduce-cognitive-load',
  'nutrition.normalize-setback',
  'nutrition.simplify-guidance',
  'nutrition.encourage-continuity',
  'nutrition.answer-curiosity',
]);

export class NutritionConversationComposer {
  private readonly dialogueProfilePolicy =
    new NutritionConversationDialogueProfilePolicy();
  private readonly flowPlanner = new NutritionConversationFlowPlanner();

  compose(
    context: NutritionConversationContext,
    decisionPlan: DecisionPlan,
  ): CompositionPlan {
    this.validatePlan(context, decisionPlan);

    const profile = this.dialogueProfilePolicy.definition(
      decisionPlan.dialogueProfile,
    );
    const flow = this.flowPlanner.plan(context, decisionPlan);
    const maximumLength = this.maximumLength(context, decisionPlan);
    const grouped = this.group(
      decisionPlan.selectedDecisions,
      decisionPlan.dialogueProfile,
    );
    const ordered = [...grouped].sort(
      (left, right) =>
        this.flowPlanner.rank(flow, left.type) -
          this.flowPlanner.rank(flow, right.type) ||
        this.profileBlockRank(profile.allowedBlocks, left.type) -
          this.profileBlockRank(profile.allowedBlocks, right.type) ||
        left.rank - right.rank ||
        this.compare(left.key, right.key),
    );
    const blocks = this.enforceFactLimit(
      ordered.map((definition, order) =>
        this.block(
          definition,
          order,
          decisionPlan,
          this.blockMaximumLength(definition, ordered, maximumLength),
          flow,
        ),
      ),
      profile.budgets.maximumFactCount,
    );
    const paragraphCount =
      blocks.length === 0
        ? 0
        : Math.max(...blocks.map((block) => block.paragraph)) + 1;
    const question = blocks.find((block) =>
      block.decisionIds.includes('nutrition.ask-question'),
    );
    const closing = blocks.find((block) =>
      block.decisionIds.includes('nutrition.close-without-question'),
    );
    this.validateProfileCoherence(decisionPlan, blocks);

    return Object.freeze({
      id: `nutrition-composition:${decisionPlan.id}`,
      decisionPlanId: decisionPlan.id,
      blocks,
      dialogueProfile: decisionPlan.dialogueProfile,
      centralIntent: decisionPlan.centralIntent,
      profileBudgets: profile.budgets,
      closingRequirement: profile.closingRequirement,
      depth: profile.depth,
      density: profile.density,
      rhythm: profile.rhythm,
      presentation: this.presentation(context, blocks, flow),
      paragraphCount,
      maximumLength,
      emojiAllowed:
        profile.emojiAllowed &&
        decisionPlan.selectedDecisions.some(
          (decision) => decision.candidateId === 'nutrition.use-emoji',
        ),
      maximumEmojiCount:
        profile.emojiAllowed &&
        decisionPlan.selectedDecisions.some(
          (decision) => decision.candidateId === 'nutrition.use-emoji',
        )
          ? Math.min(
              context.communication.idealEmojiCount,
              profile.budgets.maximumEmojiCount,
            )
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
    profile: DecisionPlan['dialogueProfile'],
  ): readonly BlockDefinition[] {
    const groups = new Map<string, BlockDefinition>();
    const selectedIds = new Set(
      decisions.map((decision) => decision.candidateId),
    );

    for (const decision of decisions) {
      if (PRESENTATION_DECISIONS.has(decision.candidateId)) continue;
      const defaultMapping = DECISION_BLOCK[decision.candidateId];
      const resolvedMapping = EMOTIONAL_DECISIONS.has(decision.candidateId)
        ? this.emotionalSupportMapping(decision.candidateId, selectedIds)
        : RECOGNITION_DECISIONS.has(decision.candidateId)
          ? this.recognitionSupportMapping(decision.candidateId, selectedIds)
          : defaultMapping?.key === 'motivation'
            ? this.motivationSupportMapping(selectedIds)
            : defaultMapping;
      const mapping =
        resolvedMapping?.key === 'recognition'
          ? { key: 'analysis', type: 'PRIMARY_OBSERVATION' as const, rank: 20 }
          : this.profileContinuityMapping(profile, resolvedMapping);
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

  private profileContinuityMapping(
    profile: DecisionPlan['dialogueProfile'],
    mapping: Omit<BlockDefinition, 'decisionIds'> | undefined,
  ): Omit<BlockDefinition, 'decisionIds'> | undefined {
    if (!mapping) return undefined;
    if (
      ['RECOVERY', 'CONTINUITY_CHECK'].includes(profile) &&
      ['continuity', 'memory', 'longitudinal'].includes(mapping.key)
    ) {
      return {
        key: 'continuity',
        type: 'HISTORICAL_COMPARISON',
        rank: 50,
      };
    }
    if (profile === 'CELEBRATE' && mapping.key === 'longitudinal') {
      return { key: 'analysis', type: 'PRIMARY_OBSERVATION', rank: 20 };
    }
    return mapping;
  }

  private recognitionSupportMapping(
    decisionId: string,
    selectedIds: ReadonlySet<string>,
  ): Omit<BlockDefinition, 'decisionIds'> {
    if (
      decisionId === 'nutrition.acknowledge-recovery' &&
      (selectedIds.has('nutrition.correct-limiting-factor') ||
        selectedIds.has('nutrition.provide-recommendation'))
    ) {
      return { key: 'correction', type: 'CORRECTION', rank: 40 };
    }
    if (
      [
        'nutrition.acknowledge-progress',
        'nutrition.acknowledge-improvement',
      ].includes(decisionId) &&
      (selectedIds.has('nutrition.mention-trend') ||
        selectedIds.has('nutrition.mention-longitudinal'))
    ) {
      return { key: 'longitudinal', type: 'TREND', rank: 70 };
    }
    if (
      decisionId === 'nutrition.acknowledge-strategy' &&
      selectedIds.has('nutrition.compare-history')
    ) {
      return { key: 'continuity', type: 'HISTORICAL_COMPARISON', rank: 50 };
    }
    return { key: 'analysis', type: 'PRIMARY_OBSERVATION', rank: 20 };
  }

  private emotionalSupportMapping(
    decisionId: string,
    selectedIds: ReadonlySet<string>,
  ): Omit<BlockDefinition, 'decisionIds'> {
    const correctionAvailable =
      selectedIds.has('nutrition.correct-limiting-factor') ||
      selectedIds.has('nutrition.provide-recommendation');
    const trendAvailable =
      selectedIds.has('nutrition.mention-trend') ||
      selectedIds.has('nutrition.mention-longitudinal');
    const historyAvailable =
      selectedIds.has('nutrition.compare-history') ||
      selectedIds.has('nutrition.use-memory');

    if (
      correctionAvailable &&
      [
        'nutrition.validate-frustration',
        'nutrition.reduce-cognitive-load',
        'nutrition.normalize-setback',
        'nutrition.simplify-guidance',
        'nutrition.answer-curiosity',
      ].includes(decisionId)
    ) {
      return { key: 'correction', type: 'CORRECTION', rank: 40 };
    }
    if (
      trendAvailable &&
      [
        'nutrition.validate-frustration',
        'nutrition.reinforce-confidence',
        'nutrition.normalize-setback',
        'nutrition.encourage-continuity',
      ].includes(decisionId)
    ) {
      return { key: 'longitudinal', type: 'TREND', rank: 70 };
    }
    if (
      historyAvailable &&
      [
        'nutrition.validate-frustration',
        'nutrition.normalize-setback',
        'nutrition.encourage-continuity',
      ].includes(decisionId)
    ) {
      return { key: 'continuity', type: 'HISTORICAL_COMPARISON', rank: 50 };
    }
    return { key: 'analysis', type: 'PRIMARY_OBSERVATION', rank: 20 };
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
  private blockMaximumLength(
    definition: BlockDefinition,
    definitions: readonly BlockDefinition[],
    maximumLength: number,
  ): number {
    const groupCount = Math.max(1, definitions.length);
    const equalShare = Math.floor(maximumLength / groupCount);
    const baseline = Math.max(40, Math.floor((equalShare * 4) / 5));
    const reserved = baseline * groupCount;
    const distributable = Math.max(0, maximumLength - reserved);
    const totalWeight = definitions.reduce(
      (total, current) => total + Math.max(1, current.decisionIds.length),
      0,
    );
    const blockWeight = Math.max(1, definition.decisionIds.length);

    return baseline + Math.floor((distributable * blockWeight) / totalWeight);
  }

  private block(
    definition: BlockDefinition,
    order: number,
    plan: DecisionPlan,
    maximumLength: number,
    flow: NutritionConversationFlowPlan,
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
      paragraph: this.flowPlanner.paragraph(flow, definition.type, order),
      presentation:
        flow.presentation === 'BULLETS' &&
        definition.key === 'analysis' &&
        definition.decisionIds.length >= 3
          ? 'BULLETS'
          : 'PROSE',
      required,
      maximumLength,
    });
  }

  private enforceFactLimit(
    blocks: readonly ConversationBlock[],
    maximumFactCount: number,
  ): readonly ConversationBlock[] {
    const factCount = new Set(blocks.flatMap((block) => block.factIds)).size;
    if (factCount > maximumFactCount) {
      throw new Error('DecisionPlan excede orçamento de fatos da composição');
    }
    return Object.freeze([...blocks]);
  }

  private maximumLength(
    context: NutritionConversationContext,
    plan: DecisionPlan,
  ): number {
    const preferred = Math.max(
      160,
      context.communication.preferredMessageLength,
    );
    const profile = this.dialogueProfilePolicy.definition(plan.dialogueProfile);
    return Math.min(preferred, profile.budgets.maximumLength);
  }

  private presentation(
    context: NutritionConversationContext,
    blocks: readonly ConversationBlock[],
    flow: NutritionConversationFlowPlan,
  ): ConversationPresentation {
    if (flow.presentation === 'PROSE') return 'PROSE';
    if (context.communication.prefersShortMessages || blocks.length <= 3)
      return 'PROSE';
    return blocks.some((block) => block.presentation === 'BULLETS')
      ? 'BULLETS'
      : 'PROSE';
  }

  private compare(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
  }

  private profileBlockRank(
    allowedBlocks: readonly ConversationBlockType[],
    block: ConversationBlockType,
  ): number {
    const rank = allowedBlocks.indexOf(block);
    return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
  }

  private validateProfileCoherence(
    plan: DecisionPlan,
    blocks: readonly ConversationBlock[],
  ): void {
    const profile = this.dialogueProfilePolicy.definition(plan.dialogueProfile);
    const selected = new Set(
      plan.selectedDecisions.map((decision) => decision.candidateId),
    );
    if (plan.centralIntent !== profile.centralIntent) {
      throw new Error('Intenção central incompatível com o perfil');
    }
    if (
      blocks.some(
        (block) =>
          !profile.allowedBlocks.includes(block.type) ||
          profile.prohibitedBlocks.includes(block.type),
      )
    ) {
      throw new Error('Perfil contém bloco proibido');
    }
    const paragraphCount =
      blocks.length === 0
        ? 0
        : Math.max(...blocks.map((block) => block.paragraph)) + 1;
    if (
      blocks.length > profile.budgets.maximumBlockCount ||
      paragraphCount > profile.budgets.maximumParagraphCount
    ) {
      throw new Error('Perfil excede orçamento estrutural');
    }
    const factCount = new Set(blocks.flatMap((block) => block.factIds)).size;
    if (factCount > profile.budgets.maximumFactCount) {
      throw new Error('Perfil excede orçamento de fatos');
    }
    if (
      plan.dialogueProfile === 'CELEBRATE' &&
      (selected.has('nutrition.provide-recommendation') ||
        selected.has('nutrition.correct-limiting-factor'))
    ) {
      throw new Error('Celebração não pode competir com correção');
    }
    if (
      plan.dialogueProfile === 'RECOVERY' &&
      selected.has('nutrition.detail-analysis')
    ) {
      throw new Error('Recuperação não pode conter análise detalhada');
    }
    if (
      profile.budgets.maximumQuestions === 0 &&
      selected.has('nutrition.ask-question')
    ) {
      throw new Error('Perfil não autoriza pergunta');
    }
  }
}
