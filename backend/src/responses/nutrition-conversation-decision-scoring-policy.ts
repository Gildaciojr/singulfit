import type {
  ConversationDecisionCategory,
  ConversationDecisionId,
  ConversationDecisionIntrinsicPriority,
  DecisionCandidate,
  DecisionPlan,
  DecisionSuppressionReason,
  SelectedDecision,
  SuppressedDecision,
} from './conversation-decision.contract';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';

const PRIORITY_ORDER: Readonly<
  Record<ConversationDecisionIntrinsicPriority, number>
> = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 });

const NON_PERCEPTIBLE_DECISIONS = new Set([
  'nutrition.respond-briefly',
  'nutrition.reduce-conversational-load',
  'nutrition.close-without-question',
]);

interface CandidateEvaluation {
  readonly priority: number;
  readonly relevance: number;
  readonly utility: number;
  readonly fatiguePenalty: number;
  readonly cognitiveCost: number;
  readonly responseCost: number;
  readonly stableId: string;
}

interface SuppressionRecord {
  readonly reason: DecisionSuppressionReason;
  readonly conflictingDecisionId?: ConversationDecisionId;
  readonly rationaleCodes: readonly string[];
}

export class NutritionConversationDecisionScoringPolicy {
  select(
    context: NutritionConversationContext,
    candidates: readonly DecisionCandidate[],
  ): DecisionPlan {
    const candidateById = this.validateCandidates(candidates);
    const availableFacts = this.availableFacts(context);
    const budget = this.behavioralBudget(context);
    const selectedIds = new Set<ConversationDecisionId>();
    const selectedCandidates: DecisionCandidate[] = [];
    const suppressions = new Map<ConversationDecisionId, SuppressionRecord>();

    for (const candidate of candidates) {
      if (candidate.prohibited) {
        if (candidate.required) {
          throw new Error(`Decisão obrigatória e proibida: ${candidate.id}`);
        }

        this.suppress(suppressions, candidate, 'PROHIBITED', [
          'CANDIDATE_MARKED_PROHIBITED',
        ]);
        continue;
      }

      if (!this.hasAvailableFacts(candidate, availableFacts)) {
        if (candidate.required) {
          throw new Error(
            `Decisão obrigatória sem fatos disponíveis: ${candidate.id}`,
          );
        }

        this.suppress(suppressions, candidate, 'CONTEXT_MISMATCH', [
          'REQUIRED_FACTS_UNAVAILABLE',
        ]);
      }
    }

    const requiredCandidates = candidates
      .filter((candidate) => candidate.required)
      .sort((left, right) =>
        this.compareCandidates(context, left, right, candidateById),
      );

    for (const candidate of requiredCandidates) {
      this.selectRequired(
        context,
        candidate,
        candidateById,
        availableFacts,
        selectedIds,
        selectedCandidates,
        suppressions,
      );
    }

    const optionalCandidates = candidates
      .filter((candidate) => !candidate.required)
      .sort((left, right) =>
        this.compareCandidates(context, left, right, candidateById),
      );

    for (const candidate of optionalCandidates) {
      if (selectedIds.has(candidate.id) || suppressions.has(candidate.id)) {
        continue;
      }

      const missingDependency = candidate.dependencyIds.find(
        (dependencyId) => !candidateById.has(dependencyId),
      );

      if (missingDependency) {
        this.suppress(suppressions, candidate, 'MISSING_DEPENDENCY', [
          `DEPENDENCY_NOT_FOUND:${missingDependency}`,
        ]);
        continue;
      }

      const unavailableDependency = candidate.dependencyIds.find(
        (dependencyId) => {
          const dependency = candidateById.get(dependencyId);
          return (
            !dependency ||
            dependency.prohibited ||
            !this.hasAvailableFacts(dependency, availableFacts)
          );
        },
      );

      if (unavailableDependency) {
        this.suppress(suppressions, candidate, 'MISSING_DEPENDENCY', [
          `DEPENDENCY_INELIGIBLE:${unavailableDependency}`,
        ]);
        continue;
      }

      for (const dependencyId of candidate.dependencyIds) {
        if (selectedIds.has(dependencyId)) {
          continue;
        }

        const dependency = candidateById.get(dependencyId);
        if (
          !dependency ||
          !this.canFit(dependency, selectedCandidates, budget)
        ) {
          continue;
        }

        this.addSelected(dependency, selectedIds, selectedCandidates);
      }

      const unsatisfiedDependency = candidate.dependencyIds.find(
        (dependencyId) => !selectedIds.has(dependencyId),
      );

      if (unsatisfiedDependency) {
        this.suppress(suppressions, candidate, 'MISSING_DEPENDENCY', [
          `DEPENDENCY_NOT_SELECTED:${unsatisfiedDependency}`,
        ]);
        continue;
      }

      const conflictingSelected = selectedCandidates.find((selected) =>
        this.conflicts(candidate, selected),
      );

      if (conflictingSelected) {
        this.suppress(
          suppressions,
          candidate,
          'CONFLICT',
          ['LOWER_CONFLICT_PRECEDENCE'],
          conflictingSelected.id,
        );
        continue;
      }

      const redundantSelected = selectedCandidates.find(
        (selected) =>
          this.redundancyGroup(selected) === this.redundancyGroup(candidate),
      );

      if (redundantSelected && this.redundancyGroup(candidate) !== null) {
        this.suppress(
          suppressions,
          candidate,
          'REDUNDANT',
          ['SEMANTIC_GROUP_ALREADY_SELECTED'],
          redundantSelected.id,
        );
        continue;
      }

      if (!this.canFit(candidate, selectedCandidates, budget)) {
        const reason = this.fatigueSuppressionReason(context, candidate);
        this.suppress(suppressions, candidate, reason, [
          reason === 'FATIGUE'
            ? 'CONVERSATIONAL_FATIGUE_PENALTY'
            : 'COMMUNICATIVE_BUDGET_EXCEEDED',
        ]);
        continue;
      }

      this.addSelected(candidate, selectedIds, selectedCandidates);
    }

    for (const candidate of candidates) {
      if (!selectedIds.has(candidate.id) && !suppressions.has(candidate.id)) {
        this.suppress(suppressions, candidate, 'LOW_RELEVANCE', [
          'NO_INCREMENTAL_VALUE',
        ]);
      }
    }

    const selectedDecisions = Object.freeze(
      selectedCandidates.map((candidate, order) =>
        this.selectedDecision(
          candidate,
          order,
          candidate.complementaryIds.some((id) => selectedIds.has(id)),
        ),
      ),
    );
    const suppressedDecisions = Object.freeze(
      candidates.flatMap((candidate) => {
        const suppression = suppressions.get(candidate.id);
        return suppression
          ? [this.suppressedDecision(candidate, suppression)]
          : [];
      }),
    );
    const primaryDecisionId = this.primaryDecision(
      context,
      selectedCandidates,
      candidateById,
    ).id;

    return Object.freeze({
      id: `nutrition-decision-plan:${context.metadata.mealAnalysisId}`,
      primaryDecisionId,
      selectedDecisions,
      suppressedDecisions,
      mandatoryDecisionIds: Object.freeze(
        candidates
          .filter((candidate) => candidate.required)
          .map((candidate) => candidate.id),
      ),
      prohibitedDecisionCodes: Object.freeze(
        [
          ...new Set(
            candidates
              .filter((candidate) => candidate.prohibited)
              .map((candidate) => candidate.code),
          ),
        ].sort(),
      ),
      maximumCommunicativeDecisions: budget,
      maximumQuestions: 1,
      maximumActions: 1,
    });
  }

  private validateCandidates(
    candidates: readonly DecisionCandidate[],
  ): ReadonlyMap<ConversationDecisionId, DecisionCandidate> {
    const candidateById = new Map<ConversationDecisionId, DecisionCandidate>();

    for (const candidate of candidates) {
      if (candidateById.has(candidate.id)) {
        throw new Error(`Identificador de decisão duplicado: ${candidate.id}`);
      }
      candidateById.set(candidate.id, candidate);
    }

    if (candidates.length === 0) {
      throw new Error('Nenhum candidato disponível para o DecisionPlan');
    }

    return candidateById;
  }

  private selectRequired(
    context: NutritionConversationContext,
    candidate: DecisionCandidate,
    candidateById: ReadonlyMap<ConversationDecisionId, DecisionCandidate>,
    availableFacts: ReadonlySet<string>,
    selectedIds: Set<ConversationDecisionId>,
    selectedCandidates: DecisionCandidate[],
    suppressions: Map<ConversationDecisionId, SuppressionRecord>,
    stack: ReadonlySet<ConversationDecisionId> = new Set(),
  ): void {
    if (selectedIds.has(candidate.id)) {
      return;
    }
    if (stack.has(candidate.id)) {
      throw new Error(`Dependência circular obrigatória: ${candidate.id}`);
    }
    if (
      candidate.prohibited ||
      !this.hasAvailableFacts(candidate, availableFacts)
    ) {
      throw new Error(`Decisão obrigatória inelegível: ${candidate.id}`);
    }

    const nextStack = new Set(stack);
    nextStack.add(candidate.id);

    for (const dependencyId of candidate.dependencyIds) {
      const dependency = candidateById.get(dependencyId);
      if (!dependency) {
        throw new Error(
          `Dependência obrigatória inexistente: ${candidate.id} -> ${dependencyId}`,
        );
      }
      this.selectRequired(
        context,
        dependency,
        candidateById,
        availableFacts,
        selectedIds,
        selectedCandidates,
        suppressions,
        nextStack,
      );
    }

    const conflict = selectedCandidates.find((selected) =>
      this.conflicts(candidate, selected),
    );
    if (conflict) {
      if (conflict.required) {
        throw new Error(
          `Decisões obrigatórias incompatíveis: ${candidate.id} e ${conflict.id}`,
        );
      }
      selectedIds.delete(conflict.id);
      selectedCandidates.splice(selectedCandidates.indexOf(conflict), 1);
      this.suppress(
        suppressions,
        conflict,
        'CONFLICT',
        ['REQUIRED_DECISION_PRECEDENCE'],
        candidate.id,
      );
    }

    this.addSelected(candidate, selectedIds, selectedCandidates);
  }

  private compareCandidates(
    context: NutritionConversationContext,
    left: DecisionCandidate,
    right: DecisionCandidate,
    candidateById: ReadonlyMap<ConversationDecisionId, DecisionCandidate>,
  ): number {
    const a = this.evaluate(context, left, candidateById);
    const b = this.evaluate(context, right, candidateById);
    const comparisons = [
      a.priority - b.priority,
      b.relevance - a.relevance,
      b.utility - a.utility,
      a.fatiguePenalty - b.fatiguePenalty,
      a.cognitiveCost - b.cognitiveCost,
      a.responseCost - b.responseCost,
    ];

    for (const result of comparisons) {
      if (result !== 0) {
        return result;
      }
    }

    return a.stableId < b.stableId ? -1 : a.stableId > b.stableId ? 1 : 0;
  }

  private evaluate(
    context: NutritionConversationContext,
    candidate: DecisionCandidate,
    candidateById: ReadonlyMap<ConversationDecisionId, DecisionCandidate>,
  ): CandidateEvaluation {
    return {
      priority: PRIORITY_ORDER[candidate.intrinsicPriority],
      relevance: this.relevance(context, candidate),
      utility:
        this.utility(context, candidate) +
        candidate.complementaryIds.filter((id) => candidateById.has(id)).length,
      fatiguePenalty: this.fatiguePenalty(context, candidate),
      cognitiveCost: this.cognitiveCost(candidate),
      responseCost: this.responseCost(candidate),
      stableId: candidate.id,
    };
  }

  private relevance(
    context: NutritionConversationContext,
    candidate: DecisionCandidate,
  ): number {
    if (candidate.id === 'nutrition.ask-question') {
      return context.communication.shouldAskQuestion &&
        context.communication.fatigue.score < 60 &&
        !context.communication.prefersShortMessages
        ? 100
        : 10;
    }
    if (candidate.id === 'nutrition.close-without-question') {
      return !context.communication.shouldAskQuestion ||
        context.communication.fatigue.score >= 60 ||
        context.communication.prefersShortMessages
        ? 100
        : 20;
    }
    if (candidate.id === 'nutrition.show-protein') {
      return context.direction.authorizedRecommendation ? 90 : 70;
    }
    if (candidate.id === 'nutrition.provide-recommendation') {
      return 100;
    }
    if (candidate.id === 'nutrition.correct-limiting-factor') {
      return 90;
    }
    if (candidate.id === 'nutrition.mention-longitudinal') {
      return 75;
    }
    if (candidate.id === 'nutrition.use-memory') {
      return 65;
    }
    return 50 + Math.min(candidate.factIds.length, 5);
  }

  private utility(
    context: NutritionConversationContext,
    candidate: DecisionCandidate,
  ): number {
    const utilities: Readonly<Record<string, number>> = {
      'nutrition.respond-to-meal': 100,
      'nutrition.qualify-estimates': 100,
      'nutrition.provide-recommendation': 95,
      'nutrition.correct-limiting-factor': 90,
      'nutrition.show-protein': 85,
      'nutrition.acknowledge-positive': 80,
      'nutrition.acknowledge-meal': 75,
      'nutrition.mention-longitudinal': 70,
      'nutrition.mention-trend': 68,
      'nutrition.compare-history': 65,
      'nutrition.use-memory': 64,
      'nutrition.mention-insight': 62,
      'nutrition.mention-goal': 60,
      'nutrition.celebrate-improvement': 58,
      'nutrition.motivate-with-evidence': 50,
      'nutrition.show-carbohydrates': 48,
      'nutrition.show-fat': 46,
      'nutrition.show-calories': 44,
      'nutrition.show-quality': 42,
      'nutrition.use-emoji': 10,
    };

    if (candidate.id === 'nutrition.ask-question') {
      return context.communication.shouldAskQuestion ? 80 : 20;
    }
    if (candidate.id === 'nutrition.close-without-question') {
      return context.communication.shouldAskQuestion ? 30 : 85;
    }
    return utilities[candidate.id] ?? 40;
  }

  private fatiguePenalty(
    context: NutritionConversationContext,
    candidate: DecisionCandidate,
  ): number {
    const fatigue = context.communication.fatigue;
    const repeated = Math.max(
      fatigue.repeatedThemeScore,
      fatigue.repeatedPhraseScore,
    );
    const affected = new Set<ConversationDecisionCategory>([
      'CURIOSITY',
      'MOTIVATION',
      'CELEBRATION',
      'MEMORY',
      'EDUCATION',
    ]);

    if (!affected.has(candidate.category)) {
      return 0;
    }

    return fatigue.score + repeated;
  }

  private cognitiveCost(candidate: DecisionCandidate): number {
    if (candidate.category === 'EDUCATION') return 40;
    if (candidate.category === 'CONTINUITY') return 30;
    if (candidate.category === 'MEMORY') return 25;
    if (candidate.category === 'MOTIVATION') return 20;
    if (candidate.category === 'PRESENTATION') return 5;
    return 10;
  }

  private responseCost(candidate: DecisionCandidate): number {
    if (candidate.category === 'CURIOSITY') return 50;
    if (candidate.id === 'nutrition.provide-recommendation') return 30;
    if (candidate.category === 'CORRECTION') return 25;
    return 0;
  }

  private behavioralBudget(context: NutritionConversationContext): number {
    const fatigue = context.communication.fatigue.score;
    if (
      fatigue >= 70 ||
      context.communication.prefersShortMessages ||
      context.communication.preferredMessageLength <= 320
    ) {
      return 2;
    }

    const complexity = [
      context.direction.authorizedRecommendation,
      context.direction.supportingEvidence.limitingFactors.length > 0,
      context.userContext.memory,
      context.userContext.trend,
      context.userContext.longitudinalSignal,
    ].filter(Boolean).length;

    if (context.communication.preferredMessageLength >= 800) {
      return Math.min(complexity >= 4 ? 5 : 4, 6);
    }
    if (complexity >= 4) {
      return 4;
    }
    if (complexity <= 1) {
      return 2;
    }
    return 3;
  }

  private canFit(
    candidate: DecisionCandidate,
    selected: readonly DecisionCandidate[],
    budget: number,
  ): boolean {
    if (candidate.required || !this.isPerceptible(candidate)) {
      return true;
    }
    return this.perceptibleCount(selected) < budget;
  }

  private perceptibleCount(candidates: readonly DecisionCandidate[]): number {
    return candidates.filter((candidate) => this.isPerceptible(candidate))
      .length;
  }

  private isPerceptible(candidate: DecisionCandidate): boolean {
    return !NON_PERCEPTIBLE_DECISIONS.has(candidate.id);
  }

  private conflicts(
    left: DecisionCandidate,
    right: DecisionCandidate,
  ): boolean {
    return (
      left.conflictingIds.includes(right.id) ||
      right.conflictingIds.includes(left.id)
    );
  }

  private redundancyGroup(candidate: DecisionCandidate): string | null {
    if (
      [
        'nutrition.show-calories',
        'nutrition.show-protein',
        'nutrition.show-carbohydrates',
        'nutrition.show-fat',
        'nutrition.show-quality',
      ].includes(candidate.id)
    )
      return 'NUTRITION_FACT';
    if (
      [
        'nutrition.celebrate-improvement',
        'nutrition.motivate-with-evidence',
      ].includes(candidate.id)
    )
      return 'ENCOURAGEMENT';
    if (
      ['nutrition.acknowledge-meal', 'nutrition.acknowledge-positive'].includes(
        candidate.id,
      )
    )
      return 'RECOGNITION';
    if (
      [
        'nutrition.provide-recommendation',
        'nutrition.correct-limiting-factor',
      ].includes(candidate.id)
    )
      return 'GUIDANCE';
    return null;
  }

  private fatigueSuppressionReason(
    context: NutritionConversationContext,
    candidate: DecisionCandidate,
  ): DecisionSuppressionReason {
    if (
      context.communication.fatigue.score >= 70 &&
      [
        'CURIOSITY',
        'MOTIVATION',
        'CELEBRATION',
        'MEMORY',
        'EDUCATION',
      ].includes(candidate.category)
    ) {
      return 'FATIGUE';
    }
    return 'BUDGET_EXCEEDED';
  }

  private availableFacts(
    context: NutritionConversationContext,
  ): ReadonlySet<string> {
    const facts = new Set<string>([
      'facts.mealCategory',
      'facts.foods',
      'communication.shouldAskQuestion',
      'communication.stageOfChange',
      'communication.prefersShortMessages',
      'communication.preferredMessageLength',
      'communication.idealEmojiCount',
      'communication.fatigue',
    ]);
    if (context.facts.totalCalories !== null) facts.add('facts.totalCalories');
    if (context.facts.totalProtein !== null) facts.add('facts.totalProtein');
    if (context.facts.totalCarbs !== null) facts.add('facts.totalCarbs');
    if (context.facts.totalFat !== null) facts.add('facts.totalFat');
    if (context.facts.qualityScore !== null) facts.add('facts.qualityScore');
    if (context.userContext.goal !== null) facts.add('userContext.goal');
    if (context.userContext.memory) facts.add('userContext.memory');
    if (context.userContext.recentMeals.length > 0)
      facts.add('userContext.recentMeals');
    if (context.userContext.insight) facts.add('userContext.insight');
    if (context.userContext.trend) facts.add('userContext.trend');
    if (context.userContext.longitudinalSignal)
      facts.add('userContext.longitudinalSignal');
    if (context.direction.authorizedRecommendation)
      facts.add('direction.authorizedRecommendation');
    if (context.direction.supportingEvidence.positiveFactors.length > 0)
      facts.add('direction.supportingEvidence.positiveFactors');
    if (context.direction.supportingEvidence.limitingFactors.length > 0)
      facts.add('direction.supportingEvidence.limitingFactors');
    return facts;
  }

  private hasAvailableFacts(
    candidate: DecisionCandidate,
    facts: ReadonlySet<string>,
  ): boolean {
    return candidate.factIds.every((factId) => facts.has(factId));
  }

  private addSelected(
    candidate: DecisionCandidate,
    selectedIds: Set<ConversationDecisionId>,
    selected: DecisionCandidate[],
  ): void {
    if (!selectedIds.has(candidate.id)) {
      selectedIds.add(candidate.id);
      selected.push(candidate);
    }
  }

  private selectedDecision(
    candidate: DecisionCandidate,
    order: number,
    complementSelected: boolean,
  ): SelectedDecision {
    return Object.freeze({
      candidateId: candidate.id,
      code: candidate.code,
      intrinsicPriority: candidate.intrinsicPriority,
      order,
      factIds: Object.freeze([...candidate.factIds]),
      rationaleCodes: Object.freeze([
        candidate.required ? 'SELECTED_REQUIRED' : 'SELECTED_BY_POLICY',
        candidate.objectiveCode,
        `INTRINSIC_PRIORITY_${candidate.intrinsicPriority}`,
        'FACTS_AVAILABLE',
        ...(complementSelected ? ['COMPLEMENT_PRESENT'] : []),
      ]),
    });
  }

  private suppressedDecision(
    candidate: DecisionCandidate,
    suppression: SuppressionRecord,
  ): SuppressedDecision {
    return Object.freeze({
      candidateId: candidate.id,
      code: candidate.code,
      reason: suppression.reason,
      ...(suppression.conflictingDecisionId
        ? { conflictingDecisionId: suppression.conflictingDecisionId }
        : {}),
      rationaleCodes: Object.freeze([
        candidate.objectiveCode,
        ...suppression.rationaleCodes,
      ]),
    });
  }

  private suppress(
    suppressions: Map<ConversationDecisionId, SuppressionRecord>,
    candidate: DecisionCandidate,
    reason: DecisionSuppressionReason,
    rationaleCodes: readonly string[],
    conflictingDecisionId?: ConversationDecisionId,
  ): void {
    if (!suppressions.has(candidate.id)) {
      suppressions.set(
        candidate.id,
        Object.freeze({
          reason,
          ...(conflictingDecisionId ? { conflictingDecisionId } : {}),
          rationaleCodes: Object.freeze([...rationaleCodes]),
        }),
      );
    }
  }

  private primaryDecision(
    context: NutritionConversationContext,
    selected: readonly DecisionCandidate[],
    candidateById: ReadonlyMap<ConversationDecisionId, DecisionCandidate>,
  ): DecisionCandidate {
    const safety = selected.find(
      (candidate) => candidate.required && candidate.category === 'SAFETY',
    );
    if (safety) return safety;
    const intent = selected.find(
      (candidate) => candidate.required && candidate.category === 'INTENT',
    );
    if (intent) return intent;
    const communicative = selected
      .filter((candidate) => candidate.category !== 'PRESENTATION')
      .sort((left, right) =>
        this.compareCandidates(context, left, right, candidateById),
      )[0];
    if (!communicative) {
      throw new Error('DecisionPlan sem decisão central comunicativa');
    }
    return communicative;
  }
}
