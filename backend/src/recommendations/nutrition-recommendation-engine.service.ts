import { Injectable } from '@nestjs/common';
import {
  NutritionInsightType,
  NutritionTrendDirection,
  RecommendationCategory,
  RecommendationPriority,
} from '@prisma/client';
import {
  NutritionRecommendationEngineInput,
  RecommendationCandidate,
} from './interfaces/recommendation.interface';

@Injectable()
export class NutritionRecommendationEngineService {
  generate(
    input: NutritionRecommendationEngineInput,
  ): RecommendationCandidate[] {
    const candidates = input.insights.map((insight) =>
      this.fromInsight(input, insight),
    );
    const sevenDayTrend = input.trends.find((trend) => trend.windowDays === 7);

    if (
      sevenDayTrend?.direction === NutritionTrendDirection.DECLINING ||
      (sevenDayTrend && sevenDayTrend.consistencyScore < 55)
    ) {
      candidates.push({
        category: RecommendationCategory.HABIT,
        priority: RecommendationPriority.HIGH,
        signalKey: 'NUTRITION:TREND_CONSISTENCY',
        title: 'Proteja uma refeição âncora',
        description:
          'Escolha uma refeição do dia para repetir uma estrutura simples com proteína, vegetal ou fibra, fonte de energia e água.',
        reason:
          'A tendência recente mostra queda ou oscilação na qualidade das refeições.',
        evidence: {
          windowDays: sevenDayTrend.windowDays,
          direction: sevenDayTrend.direction,
          consistencyScore: sevenDayTrend.consistencyScore,
          goalAdherenceScore: sevenDayTrend.goalAdherenceScore,
        },
        confidence: {
          contextSources: 3,
          historyDepth: sevenDayTrend.mealsAnalyzed,
          recurrence: Math.max(1, Math.round(sevenDayTrend.mealsAnalyzed / 3)),
          signalStrength: 100 - sevenDayTrend.consistencyScore,
        },
      });
    }

    const registeredMeals = Math.max(
      0,
      ...input.patterns.map((pattern) => pattern.mealCount),
    );
    const activeCategories = input.patterns.filter(
      (pattern) => pattern.frequencyPerWeek >= 1,
    ).length;

    if (registeredMeals >= 5 && activeCategories <= 2) {
      candidates.push({
        category: RecommendationCategory.HABIT,
        priority: RecommendationPriority.MEDIUM,
        signalKey: 'NUTRITION:MEAL_DISTRIBUTION',
        title: 'Distribua melhor seus registros de refeições',
        description:
          'Registre e organize uma refeição que costuma ficar de fora, sem aumentar porções ou criar horários rígidos.',
        reason:
          'O histórico está concentrado em poucas categorias de refeição.',
        evidence: {
          registeredMeals,
          activeCategories,
          patternCategories: input.patterns.length,
        },
        confidence: {
          contextSources: 2,
          historyDepth: registeredMeals,
          recurrence: Math.max(1, 4 - activeCategories),
          signalStrength: 70,
        },
      });
    }

    return candidates;
  }

  private fromInsight(
    input: NutritionRecommendationEngineInput,
    insight: NutritionRecommendationEngineInput['insights'][number],
  ): RecommendationCandidate {
    const restrictionNote =
      input.restrictionsCount > 0
        ? ' usando opções compatíveis com suas restrições cadastradas'
        : '';
    const common = {
      reason: `${insight.title} aparece no histórico nutricional recente.`,
      evidence: {
        insightType: insight.type,
        occurrences: insight.occurrences,
        goal: input.goal ?? 'UNKNOWN',
        restrictionsCount: input.restrictionsCount,
      },
      confidence: {
        contextSources: 3,
        historyDepth: insight.occurrences,
        recurrence: insight.occurrences,
        signalStrength: Math.min(100, 50 + insight.occurrences * 10),
      },
    };

    switch (insight.type) {
      case NutritionInsightType.LOW_PROTEIN:
        return {
          ...common,
          category: RecommendationCategory.NUTRITION,
          priority: this.priority(insight.occurrences),
          signalKey: 'NUTRITION:LOW_PROTEIN',
          title: 'Aumente a presença de proteína',
          description: `Inclua uma fonte prática de proteína na próxima refeição semelhante${restrictionNote}, como ovos, frango, peixe, tofu ou leguminosas.`,
        };
      case NutritionInsightType.INSUFFICIENT_HYDRATION:
        return {
          ...common,
          category: RecommendationCategory.HYDRATION,
          priority: this.priority(insight.occurrences),
          signalKey: 'NUTRITION:HYDRATION',
          title: 'Associe água à sua rotina alimentar',
          description:
            'Deixe água visível e beba ao longo do período da refeição, sem metas extremas.',
        };
      case NutritionInsightType.HIGH_ULTRA_PROCESSED:
        return {
          ...common,
          category: RecommendationCategory.NUTRITION,
          priority: this.priority(insight.occurrences),
          signalKey: 'NUTRITION:ULTRA_PROCESSED',
          title: 'Reduza um ultraprocessado recorrente',
          description:
            'Troque apenas um item recorrente por uma opção simples com poucos ingredientes na próxima refeição equivalente.',
        };
      case NutritionInsightType.EXCESS_SUGAR:
        return {
          ...common,
          category: RecommendationCategory.NUTRITION,
          priority: this.priority(insight.occurrences),
          signalKey: 'NUTRITION:EXCESS_SUGAR',
          title: 'Reduza uma fonte concentrada de açúcar',
          description:
            'Substitua uma bebida adoçada ou sobremesa frequente por água ou fruta inteira na próxima ocasião semelhante.',
        };
      case NutritionInsightType.LOW_VEGETABLES:
        return {
          ...common,
          category: RecommendationCategory.NUTRITION,
          priority: this.priority(insight.occurrences),
          signalKey: 'NUTRITION:LOW_VEGETABLES',
          title: 'Acrescente fibras e vegetais gradualmente',
          description: `Inclua uma porção de verdura, legume, feijão ou fruta${restrictionNote} na próxima refeição semelhante.`,
        };
      case NutritionInsightType.UNBALANCED_MEALS:
        return {
          ...common,
          category: RecommendationCategory.HABIT,
          priority: this.priority(insight.occurrences),
          signalKey: 'NUTRITION:UNBALANCED_MEALS',
          title: 'Simplifique a estrutura da refeição',
          description:
            'Combine uma fonte de proteína, uma de fibras ou vegetais e uma fonte de energia em porções compatíveis com sua fome.',
        };
    }
  }

  private priority(occurrences: number): RecommendationPriority {
    return occurrences >= 4
      ? RecommendationPriority.HIGH
      : occurrences >= 2
        ? RecommendationPriority.MEDIUM
        : RecommendationPriority.LOW;
  }
}
