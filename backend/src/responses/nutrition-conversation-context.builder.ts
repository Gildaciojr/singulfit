import { Injectable } from '@nestjs/common';
import {
  BehavioralCommunicationStyle,
  BehavioralMotivationStyle,
  CoachCommunicationStyle,
  CoachMotivationStyle,
  GoalProgressionState,
  LongitudinalDirection,
  MealCategory,
  StageOfChange,
} from '@prisma/client';
import { CoachResponseSignals } from '../automation/interfaces/coach-context.interface';
import { BehavioralSignals } from '../behavior/interfaces/behavioral.interface';
import { LongitudinalResponseContext } from '../longitudinal/interfaces/longitudinal.interface';
import { NutritionUserContext } from '../nutrition/interfaces/nutrition-context.interface';
import {
  NutritionConversationCommunicationStyle,
  NutritionConversationConstraint,
  NutritionConversationContext,
  NutritionConversationLongitudinalSignal,
  NutritionConversationMotivationFocus,
  NutritionConversationTrendDirection,
} from './nutrition-conversation-context.interface';

const MAX_SUPPORTING_FACTORS = 3;
const MAX_ADAPTIVE_TOPICS = 3;
const MAX_RECENT_MEALS = 2;

interface NumericValue {
  toNumber(): number;
}

interface NutritionConversationAnalysisInput {
  readonly id: string;
  readonly mealCategory: MealCategory;
  readonly confidence: NumericValue | null;
  readonly totalCalories: NumericValue | null;
  readonly totalProtein: NumericValue | null;
  readonly totalCarbs: NumericValue | null;
  readonly totalFat: NumericValue | null;
  readonly qualityScore: {
    readonly score: number;
  } | null;
  readonly items: readonly {
    readonly foodName: string;
    readonly estimatedGrams: NumericValue;
  }[];
}

interface NutritionConversationRecommendationInput {
  readonly recommendationId?: string;
  readonly title: string;
  readonly action: string;
  readonly rationale?: string;
}

export interface BuildNutritionConversationContextInput {
  readonly analysis: NutritionConversationAnalysisInput;
  readonly context: NutritionUserContext;
  readonly recommendations: readonly NutritionConversationRecommendationInput[];
  readonly coach: Omit<CoachResponseSignals, 'adaptive'> & {
    readonly adaptive?: CoachResponseSignals['adaptive'];
  };
  readonly behavior: Omit<
    BehavioralSignals,
    'communicationStyle' | 'motivationStyle'
  > & {
    readonly communicationStyle?: BehavioralSignals['communicationStyle'];
    readonly motivationStyle?: BehavioralSignals['motivationStyle'];
  };
  readonly longitudinal?: LongitudinalResponseContext;
}

@Injectable()
export class NutritionConversationContextBuilder {
  build(
    input: BuildNutritionConversationContextInput,
  ): NutritionConversationContext {
    const recommendation = input.recommendations[0];
    const foodNames = input.analysis.items.map((item) => item.foodName);
    const memory = this.selectMemory(input.context, foodNames, recommendation);
    const adaptive = input.coach.adaptive;
    const trend = this.selectTrend(input.context);
    const insight = this.selectInsight(input.context);
    const longitudinalSignal = this.selectLongitudinalSignal(
      input.longitudinal,
    );
    const shouldAskQuestion =
      input.coach.experience.fatigue.score < 70 &&
      (input.behavior.stage === StageOfChange.CONTEMPLATION ||
        input.behavior.stage === StageOfChange.PREPARATION);

    return Object.freeze({
      metadata: Object.freeze({
        mealAnalysisId: input.analysis.id,
        ...(recommendation?.recommendationId
          ? { recommendationId: recommendation.recommendationId }
          : {}),
      }),
      facts: Object.freeze({
        mealCategory: input.analysis.mealCategory,
        foods: Object.freeze(
          input.analysis.items.map((item) =>
            Object.freeze({
              name: item.foodName,
              estimatedGrams: item.estimatedGrams.toNumber(),
            }),
          ),
        ),
        totalCalories: this.numberOrNull(input.analysis.totalCalories),
        totalProtein: this.numberOrNull(input.analysis.totalProtein),
        totalCarbs: this.numberOrNull(input.analysis.totalCarbs),
        totalFat: this.numberOrNull(input.analysis.totalFat),
        qualityScore: input.analysis.qualityScore?.score ?? null,
        ...(input.analysis.confidence
          ? { confidence: input.analysis.confidence.toNumber() }
          : {}),
      }),
      policies: Object.freeze({
        requiresEstimateQualification: true,
      }),
      userContext: Object.freeze({
        goal: input.context.goal,
        activityLevel: input.context.activityLevel,
        relevantRestrictions: this.constraints(input.context.restrictions),
        relevantAllergies: this.constraints(input.context.allergies),
        preferredLanguage: input.context.preferences?.preferredLanguage ?? null,
        timezone: input.context.preferences?.timezone ?? null,
        ...(memory
          ? { memory: Object.freeze({ summary: memory.summary }) }
          : {}),
        recentMeals: this.recentMeals(input.context),
        ...(insight
          ? {
              insight: Object.freeze({
                title: insight.title,
                summary: insight.summary,
              }),
            }
          : {}),
        ...(trend
          ? {
              trend: Object.freeze({
                windowDays: trend.windowDays,
                averageQualityScore: trend.averageQualityScore,
                direction: trend.direction,
                consistencyScore: trend.consistencyScore,
                goalAdherenceScore: trend.goalAdherenceScore,
              }),
            }
          : {}),
        ...(longitudinalSignal ? { longitudinalSignal } : {}),
      }),
      direction: Object.freeze({
        ...(recommendation
          ? {
              authorizedRecommendation: Object.freeze({
                title: recommendation.title,
                action: recommendation.action,
                ...(recommendation.rationale
                  ? { rationale: recommendation.rationale }
                  : {}),
              }),
            }
          : {}),
        supportingEvidence: Object.freeze({
          positiveFactors: this.limitedStrings(
            adaptive?.foodQuality?.positiveFactors,
            MAX_SUPPORTING_FACTORS,
          ),
          limitingFactors: this.limitedStrings(
            adaptive?.foodQuality?.limitingFactors,
            MAX_SUPPORTING_FACTORS,
          ),
        }),
      }),
      communication: Object.freeze({
        communicationStyle: this.communicationStyle(
          input.behavior.communicationStyle,
          input.coach.communicationStyle,
        ),
        coachingStyle: input.coach.coachingStyle,
        tone: input.coach.tone,
        motivationFocus: this.motivationFocus(
          input.behavior.motivationStyle,
          input.coach.motivationStyle,
        ),
        prefersShortMessages: input.behavior.useShortMessages,
        preferredMessageLength:
          input.coach.experience.whatsapp.idealMessageLength,
        idealEmojiCount: input.coach.experience.whatsapp.idealEmojiCount,
        fatigue: Object.freeze({
          score: input.coach.experience.fatigue.score,
          repeatedThemeScore: input.coach.experience.fatigue.repeatedThemeScore,
          repeatedPhraseScore:
            input.coach.experience.fatigue.repeatedPhraseScore,
        }),
        stageOfChange: input.behavior.stage,
        preferredTopics: this.limitedStrings(
          adaptive?.learning.preferredTopics,
          MAX_ADAPTIVE_TOPICS,
        ),
        ignoredTopics: this.limitedStrings(
          adaptive?.learning.ignoredTopics,
          MAX_ADAPTIVE_TOPICS,
        ),
        shouldAskQuestion,
      }),
    });
  }

  private communicationStyle(
    behaviorStyle: BehavioralCommunicationStyle | undefined,
    coachStyle: CoachCommunicationStyle,
  ): NutritionConversationCommunicationStyle {
    if (behaviorStyle) {
      const behaviorMapping: Record<
        BehavioralCommunicationStyle,
        NutritionConversationCommunicationStyle
      > = {
        [BehavioralCommunicationStyle.DIRECT]: 'DIRECT',
        [BehavioralCommunicationStyle.FRIENDLY]: 'FRIENDLY',
        [BehavioralCommunicationStyle.ANALYTICAL]: 'ANALYTICAL',
        [BehavioralCommunicationStyle.COACH]: 'COACHING',
        [BehavioralCommunicationStyle.MOTIVATIONAL]: 'MOTIVATIONAL',
      };

      return behaviorMapping[behaviorStyle];
    }

    const coachMapping: Record<
      CoachCommunicationStyle,
      NutritionConversationCommunicationStyle
    > = {
      [CoachCommunicationStyle.FORMAL]: 'ANALYTICAL',
      [CoachCommunicationStyle.BALANCED]: 'BALANCED',
      [CoachCommunicationStyle.FRIENDLY]: 'FRIENDLY',
    };

    return coachMapping[coachStyle];
  }

  private motivationFocus(
    behaviorStyle: BehavioralMotivationStyle | undefined,
    coachStyle: CoachMotivationStyle,
  ): NutritionConversationMotivationFocus {
    if (behaviorStyle) {
      const behaviorMapping: Record<
        BehavioralMotivationStyle,
        NutritionConversationMotivationFocus
      > = {
        [BehavioralMotivationStyle.HEALTH]: 'HEALTH',
        [BehavioralMotivationStyle.AESTHETICS]: 'APPEARANCE',
        [BehavioralMotivationStyle.PERFORMANCE]: 'PERFORMANCE',
        [BehavioralMotivationStyle.LONGEVITY]: 'LONGEVITY',
        [BehavioralMotivationStyle.SELF_ESTEEM]: 'SELF_ESTEEM',
      };

      return behaviorMapping[behaviorStyle];
    }

    const coachMapping: Record<
      CoachMotivationStyle,
      NutritionConversationMotivationFocus
    > = {
      [CoachMotivationStyle.DATA_DRIVEN]: 'DATA',
      [CoachMotivationStyle.ACHIEVEMENT]: 'ACHIEVEMENT',
      [CoachMotivationStyle.HEALTH]: 'HEALTH',
      [CoachMotivationStyle.APPEARANCE]: 'APPEARANCE',
    };

    return coachMapping[coachStyle];
  }

  private selectLongitudinalSignal(
    context: LongitudinalResponseContext | undefined,
  ): NutritionConversationLongitudinalSignal | undefined {
    if (context?.evolution) {
      return Object.freeze({
        kind: 'NUTRITION_EVOLUTION',
        direction: this.longitudinalDirection(
          context.evolution.overallDirection,
        ),
      });
    }

    if (context?.goalProgression) {
      return Object.freeze({
        kind: 'GOAL_PROGRESSION',
        direction: this.goalProgressionDirection(context.goalProgression.state),
        score: context.goalProgression.score,
      });
    }

    return undefined;
  }

  private longitudinalDirection(
    direction: LongitudinalDirection,
  ): NutritionConversationTrendDirection {
    const mapping: Record<
      LongitudinalDirection,
      NutritionConversationTrendDirection
    > = {
      [LongitudinalDirection.IMPROVING]: 'IMPROVING',
      [LongitudinalDirection.STABLE]: 'STABLE',
      [LongitudinalDirection.DECLINING]: 'DECLINING',
    };

    return mapping[direction];
  }

  private goalProgressionDirection(
    state: GoalProgressionState,
  ): NutritionConversationTrendDirection {
    const mapping: Record<
      GoalProgressionState,
      NutritionConversationTrendDirection
    > = {
      [GoalProgressionState.IMPROVING]: 'IMPROVING',
      [GoalProgressionState.STABLE]: 'STABLE',
      [GoalProgressionState.DECLINING]: 'DECLINING',
    };

    return mapping[state];
  }

  private recentMeals(
    context: NutritionUserContext,
  ): NutritionConversationContext['userContext']['recentMeals'] {
    return Object.freeze(
      [...context.recentMeals]
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            left.id.localeCompare(right.id, 'pt-BR'),
        )
        .slice(0, MAX_RECENT_MEALS)
        .map((meal) =>
          Object.freeze({
            occurredAt: meal.createdAt.toISOString(),
            category: meal.category,
            score: meal.score,
            foods: Object.freeze([...meal.foods]),
          }),
        ),
    );
  }

  private selectTrend(context: NutritionUserContext) {
    const trends = [...context.trends].sort(
      (left, right) => left.windowDays - right.windowDays,
    );

    return trends.find((item) => item.windowDays === 7) ?? trends[0];
  }

  private selectInsight(context: NutritionUserContext) {
    return [...context.activeInsights].sort(
      (left, right) =>
        right.occurrences - left.occurrences ||
        left.type.localeCompare(right.type, 'pt-BR') ||
        left.title.localeCompare(right.title, 'pt-BR'),
    )[0];
  }

  private numberOrNull(value: NumericValue | null): number | null {
    return value?.toNumber() ?? null;
  }

  private constraints(
    values: unknown[],
  ): readonly NutritionConversationConstraint[] {
    return Object.freeze(
      values.flatMap((value) => {
        if (typeof value === 'string' && value.trim()) {
          return [Object.freeze({ description: value.trim() })];
        }

        if (!this.isRecord(value)) {
          return [];
        }

        const type = this.optionalString(value.type);
        const description =
          this.optionalString(value.description) ??
          this.optionalString(value.name);

        if (!description) {
          return [];
        }

        return [
          Object.freeze({
            ...(type ? { type } : {}),
            description,
          }),
        ];
      }),
    );
  }

  private selectMemory(
    context: NutritionUserContext,
    foods: readonly string[],
    recommendation: NutritionConversationRecommendationInput | undefined,
  ) {
    const relevantTerms = this.terms(
      [
        ...foods,
        context.goal ?? '',
        recommendation?.title ?? '',
        recommendation?.action ?? '',
      ].join(' '),
    );

    return [...context.memories]
      .map((memory) => ({
        memory,
        relevance: Array.from(this.terms(memory.summary)).filter((term) =>
          relevantTerms.has(term),
        ).length,
      }))
      .filter((candidate) => candidate.relevance > 0)
      .sort(
        (left, right) =>
          right.relevance - left.relevance ||
          left.memory.summary.localeCompare(right.memory.summary, 'pt-BR'),
      )[0]?.memory;
  }

  private limitedStrings(
    values: readonly string[] | undefined,
    limit: number,
  ): readonly string[] {
    return Object.freeze([...(values ?? [])].slice(0, limit));
  }

  private terms(value: string): Set<string> {
    const ignored = new Set([
      'para',
      'como',
      'mais',
      'menos',
      'uma',
      'com',
      'sem',
      'seu',
      'sua',
    ]);

    return new Set(
      value
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLocaleLowerCase('pt-BR')
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 4 && !ignored.has(term)),
    );
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
