import type {
  AuthorizedFact,
  AuthorizedFactId,
  AuthorizedFactSource,
  AuthorizedFacts,
  AuthorizedFactValue,
} from './conversation-authorized-facts.contract';
import type { NutritionConversationContext } from './nutrition-conversation-context.interface';

export class NutritionConversationAuthorizedFactsBuilder {
  build(context: NutritionConversationContext): AuthorizedFacts {
    const sensitiveEpisodes: AuthorizedFact[] = [];
    const allowed: AuthorizedFact[] = [
      this.fact(
        'facts.mealCategory',
        'MEAL_ANALYSIS',
        context.facts.mealCategory,
      ),
      this.fact(
        'facts.foods',
        'MEAL_ANALYSIS',
        context.facts.foods.map((food) => ({
          name: food.name,
          estimatedGrams: food.estimatedGrams,
        })),
        true,
      ),
      this.fact(
        'communication.style',
        'BEHAVIOR',
        context.communication.communicationStyle,
      ),
      this.fact(
        'communication.coachingStyle',
        'COACH',
        context.communication.coachingStyle,
      ),
      this.fact('communication.tone', 'COACH', context.communication.tone),
      this.fact(
        'communication.motivationFocus',
        'BEHAVIOR',
        context.communication.motivationFocus,
      ),
      this.fact(
        'communication.prefersShortMessages',
        'BEHAVIOR',
        context.communication.prefersShortMessages,
      ),
      this.fact(
        'communication.preferredMessageLength',
        'COACH',
        context.communication.preferredMessageLength,
      ),
      this.fact(
        'communication.idealEmojiCount',
        'COACH',
        context.communication.idealEmojiCount,
      ),

      this.fact(
        'communication.shouldAskQuestion',
        'BEHAVIOR',
        context.communication.shouldAskQuestion,
      ),
      this.fact(
        'communication.stageOfChange',
        'BEHAVIOR',
        context.communication.stageOfChange,
      ),
    ];

    this.addOptionalNumber(
      allowed,
      'facts.totalCalories',
      context.facts.totalCalories,
      context.facts.confidence,
    );
    this.addOptionalNumber(
      allowed,
      'facts.totalProtein',
      context.facts.totalProtein,
      context.facts.confidence,
    );
    this.addOptionalNumber(
      allowed,
      'facts.totalCarbs',
      context.facts.totalCarbs,
      context.facts.confidence,
    );
    this.addOptionalNumber(
      allowed,
      'facts.totalFat',
      context.facts.totalFat,
      context.facts.confidence,
    );
    if (context.facts.qualityScore !== null) {
      allowed.push(
        this.fact(
          'facts.qualityScore',
          'MEAL_ANALYSIS',
          this.qualityMeaning(context.facts.qualityScore),
        ),
      );
    }
    if (context.facts.confidence !== undefined) {
      allowed.push(
        this.fact(
          'facts.confidence',
          'MEAL_ANALYSIS',
          context.facts.confidence < 0.7
            ? 'a estimativa visual possui incerteza relevante'
            : 'a estimativa visual possui boa nitidez',
        ),
      );
    }
    if (context.userContext.activityLevel !== null) {
      allowed.push(
        this.fact(
          'userContext.activityLevel',
          'USER_CONTEXT',
          context.userContext.activityLevel,
        ),
      );
    }
    if (context.userContext.preferredLanguage !== null) {
      allowed.push(
        this.fact(
          'userContext.preferredLanguage',
          'USER_CONTEXT',
          context.userContext.preferredLanguage,
        ),
      );
    }
    if (context.userContext.timezone !== null) {
      allowed.push(
        this.fact(
          'userContext.timezone',
          'USER_CONTEXT',
          context.userContext.timezone,
        ),
      );
    }
    if (context.direction.authorizedRecommendation) {
      allowed.push(
        this.fact(
          'direction.authorizedRecommendation',
          'RECOMMENDATION',
          context.direction.authorizedRecommendation,
        ),
      );
    }
    if (context.direction.supportingEvidence.positiveFactors.length > 0) {
      allowed.push(
        this.fact(
          'direction.supportingEvidence.positiveFactors',
          'COACH',
          context.direction.supportingEvidence.positiveFactors,
        ),
      );
    }
    if (context.direction.supportingEvidence.limitingFactors.length > 0) {
      allowed.push(
        this.fact(
          'direction.supportingEvidence.limitingFactors',
          'COACH',
          context.direction.supportingEvidence.limitingFactors,
        ),
      );
    }
    for (const signal of context.recognition?.signals ?? []) {
      allowed.push(
        this.fact(`recognition.${signal.kind}`, signal.origin, {
          kind: signal.kind,
          evidence: signal.evidence,
          ...(signal.goalRelation ? { goalRelation: signal.goalRelation } : {}),
        }),
      );
    }
    for (const signal of context.emotional?.signals ?? []) {
      allowed.push(
        this.fact(`emotional.${signal.kind}`, signal.origin, {
          kind: signal.kind,
          evidence: signal.evidence,
        }),
      );
    }
    if (context.dialogue?.specificQuestion) {
      allowed.push(
        this.fact('dialogue.specificQuestion', 'USER_CONTEXT', true),
      );
    }
    if (context.dialogue?.explicitDetailRequest) {
      allowed.push(
        this.fact('dialogue.explicitDetailRequest', 'USER_CONTEXT', true),
      );
    }
    if (context.dialogue?.previousCommitmentAvailable) {
      allowed.push(
        this.fact('dialogue.previousCommitmentAvailable', 'MEMORY', true),
      );
    }
    const episodicCategories = new Set<string>();
    for (const episode of context.episodicMemory?.episodes ?? []) {
      if (episodicCategories.has(episode.category)) continue;
      episodicCategories.add(episode.category);
      const authorizedEpisode = this.fact(
        `episodicMemory.${episode.category}`,
        'MEMORY',
        {
          category: episode.category,
          fact: episode.fact,
          relationToContext: episode.relationToContext,
          recallReason: episode.recallReason,
        },
        false,
        undefined,
        episode.sensitivity === 'SENSITIVE',
      );
      if (episode.sensitivity === 'SENSITIVE') {
        sensitiveEpisodes.push(authorizedEpisode);
      } else {
        allowed.push(authorizedEpisode);
      }
    }

    const sensitive = [...this.sensitiveFacts(context), ...sensitiveEpisodes];
    const disclaimerRequired = context.policies.requiresEstimateQualification
      ? allowed
          .filter(
            (fact) =>
              fact.id === 'facts.foods' ||
              (fact.source === 'MEAL_ANALYSIS' && fact.estimated),
          )
          .map((fact) => fact.id)
      : [];

    return Object.freeze({
      allowed: Object.freeze(allowed),
      restricted: Object.freeze([
        'metadata.mealAnalysisId',
        'metadata.recommendationId',
      ]),
      sensitive: Object.freeze(sensitive),
      disclaimerRequired: Object.freeze(disclaimerRequired),
    });
  }

  private sensitiveFacts(
    context: NutritionConversationContext,
  ): readonly AuthorizedFact[] {
    const facts: AuthorizedFact[] = [];
    if (context.userContext.goal !== null) {
      facts.push(
        this.fact(
          'userContext.goal',
          'USER_CONTEXT',
          context.userContext.goal,
          false,
          undefined,
          true,
        ),
      );
    }
    if (context.userContext.relevantRestrictions.length > 0) {
      facts.push(
        this.fact(
          'userContext.relevantRestrictions',
          'USER_CONTEXT',
          context.userContext.relevantRestrictions.map((constraint) => ({
            ...(constraint.type ? { type: constraint.type } : {}),
            description: constraint.description,
          })),
          false,
          undefined,
          true,
        ),
      );
    }
    if (context.userContext.relevantAllergies.length > 0) {
      facts.push(
        this.fact(
          'userContext.relevantAllergies',
          'USER_CONTEXT',
          context.userContext.relevantAllergies.map((constraint) => ({
            ...(constraint.type ? { type: constraint.type } : {}),
            description: constraint.description,
          })),
          false,
          undefined,
          true,
        ),
      );
    }
    if (
      context.userContext.memory &&
      !this.containsTechnicalValue(context.userContext.memory.summary)
    ) {
      facts.push(
        this.fact(
          'userContext.memory',
          'MEMORY',
          context.userContext.memory,
          false,
          undefined,
          true,
        ),
      );
    }
    if (context.userContext.recentMeals.length > 0) {
      facts.push(
        this.fact(
          'userContext.recentMeals',
          'USER_CONTEXT',
          context.userContext.recentMeals.map((meal) => ({
            occurredAt: meal.occurredAt,
            category: meal.category,
            quality: meal.score === null ? null : this.scoreMeaning(meal.score),
            foods: [...meal.foods],
          })),
          false,
          undefined,
          true,
        ),
      );
    }
    if (
      context.userContext.insight &&
      !this.containsTechnicalValue(context.userContext.insight)
    ) {
      facts.push(
        this.fact(
          'userContext.insight',
          'USER_CONTEXT',
          context.userContext.insight,
          false,
          undefined,
          true,
        ),
      );
    }
    if (context.userContext.trend) {
      facts.push(
        this.fact(
          'userContext.trend',
          'LONGITUDINAL',
          {
            windowDays: context.userContext.trend.windowDays,
            direction: this.directionMeaning(
              context.userContext.trend.direction,
            ),
          },
          false,
          undefined,
          true,
        ),
      );
    }
    if (context.userContext.longitudinalSignal) {
      facts.push(
        this.fact(
          'userContext.longitudinalSignal',
          'LONGITUDINAL',
          {
            kind:
              context.userContext.longitudinalSignal.kind ===
              'NUTRITION_EVOLUTION'
                ? 'evolução das escolhas alimentares'
                : 'evolução em direção ao objetivo',
            direction: this.directionMeaning(
              context.userContext.longitudinalSignal.direction,
            ),
          },
          false,
          undefined,
          true,
        ),
      );
    }
    return Object.freeze(facts);
  }

  private addOptionalNumber(
    target: AuthorizedFact[],
    id: AuthorizedFactId,
    value: number | null,
    confidence: number | undefined,
  ): void {
    if (value !== null) {
      void confidence;
      target.push(this.fact(id, 'MEAL_ANALYSIS', value, true));
    }
  }

  private qualityMeaning(score: number): AuthorizedFactValue {
    return this.scoreMeaning(score);
  }

  private scoreMeaning(score: number): string {
    if (score >= 80) return 'muito bom';
    if (score >= 60) return 'bom, com espaço para um ajuste pequeno';
    if (score >= 40) return 'parcial, com pontos importantes a equilibrar';
    return 'baixo isoladamente, pedindo equilíbrio na próxima escolha';
  }

  private directionMeaning(direction: string): string {
    if (direction === 'IMPROVING') return 'em evolução';
    if (direction === 'DECLINING') return 'oscilou para baixo recentemente';
    return 'estável';
  }

  private containsTechnicalValue(value: AuthorizedFactValue): boolean {
    if (typeof value === 'string') {
      return /(?:\bscore\b|\bíndice\b|\bconfidence\b|\bmomentum\b|\bretention\b|\brisk\b|\d+\s*\/\s*100)/iu.test(
        value,
      );
    }
    if (Array.isArray(value)) {
      return value.some((item) => this.containsTechnicalValue(item));
    }
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).some((item) =>
        this.containsTechnicalValue(item),
      );
    }
    return false;
  }

  private fact(
    id: AuthorizedFactId,
    source: AuthorizedFactSource,
    value: AuthorizedFactValue,
    estimated = false,
    confidence?: number,
    sensitive = false,
  ): AuthorizedFact {
    return Object.freeze({
      id,
      source,
      value: this.freezeValue(value),
      ...(confidence !== undefined ? { confidence } : {}),
      estimated,
      sensitive,
    });
  }

  private freezeValue(value: AuthorizedFactValue): AuthorizedFactValue {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((item) => this.freezeValue(item)));
    }
    if (typeof value === 'object' && value !== null) {
      return Object.freeze(
        Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            this.freezeValue(item),
          ]),
        ),
      );
    }
    return value;
  }
}
