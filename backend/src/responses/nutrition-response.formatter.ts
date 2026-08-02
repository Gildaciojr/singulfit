import { Injectable } from '@nestjs/common';
import { FitnessGoal, MealCategory } from '@prisma/client';
import type { CoachResponseSignals } from '../automation/interfaces/coach-context.interface';
import type { BehavioralSignals } from '../behavior/interfaces/behavioral.interface';
import type { LongitudinalResponseContext } from '../longitudinal/interfaces/longitudinal.interface';
import type { NutritionUserContext } from '../nutrition/interfaces/nutrition-context.interface';

export interface NutritionResponseItem {
  foodName: string;
  estimatedGrams: { toNumber(): number };
}

export interface NutritionResponseAnalysis {
  totalCalories: { toNumber(): number } | null;
  totalProtein: { toNumber(): number } | null;
  totalCarbs: { toNumber(): number } | null;
  totalFat: { toNumber(): number } | null;
  mealCategory: MealCategory;
  qualityScore: {
    score: number;
    proteinScore: number;
    fiberScore: number;
    goalAdherenceScore: number;
  } | null;
  items: NutritionResponseItem[];
}

export interface NutritionResponseContext {
  context: NutritionUserContext;
  coach: CoachResponseSignals;
  behavior: BehavioralSignals;
  longitudinal: LongitudinalResponseContext;
  recommendations: Array<{
    title: string;
    rationale: string;
    action: string;
  }>;
}

const MAX_DISPLAYED_ITEMS = 20;

@Injectable()
export class NutritionResponseFormatter {
  format(
    analysis: NutritionResponseAnalysis,
    responseContext: NutritionResponseContext,
  ): string {
    const totals = this.requireTotals(analysis);
    const itemLimit =
      responseContext.coach.experience.fatigue.score >= 60
        ? 4
        : responseContext.behavior.useShortMessages
          ? 6
          : MAX_DISPLAYED_ITEMS;
    const displayedItems = analysis.items.slice(0, itemLimit);
    const foods = displayedItems.map(
      (item) =>
        `${this.foodEmoji(item.foodName)} ${item.foodName} (${this.formatNumber(item.estimatedGrams.toNumber())}g)`,
    );
    if (analysis.items.length > itemLimit) {
      foods.push(
        `• E mais ${analysis.items.length - itemLimit} item(ns) identificado(s)`,
      );
    }

    const recommendation = responseContext.recommendations[0];
    const activeInsight = responseContext.context.activeInsights[0];
    const trend = responseContext.context.trends.find(
      (item) => item.windowDays === 7,
    );
    const score = analysis.qualityScore?.score;

    return [
      this.opening(analysis, responseContext),
      '',
      ...(foods.length > 0
        ? foods
        : ['Não consegui separar com segurança os itens da imagem.']),
      '',
      `A estimativa ficou em ${this.formatNumber(totals.calories)} kcal, com ${this.formatNumber(totals.protein)}g de proteína, ${this.formatNumber(totals.carbs)}g de carboidratos e ${this.formatNumber(totals.fat)}g de gorduras.`,
      '',
      this.qualityMeaning(score),
      this.goalImpact(
        responseContext.context.goal,
        analysis.qualityScore,
        totals.protein,
      ),
      activeInsight &&
      this.isPublicText(activeInsight.title) &&
      this.isPublicText(activeInsight.summary)
        ? `${activeInsight.title}. ${activeInsight.summary}`
        : this.trendMeaning(trend, responseContext.context.recentMeals.length),
      this.rhythmMeaning(responseContext.coach, responseContext.behavior),
      '',
      recommendation
        ? `${recommendation.title}: ${recommendation.action}`
        : 'Na próxima refeição, tente combinar uma fonte de proteína, vegetais ou fibras, uma fonte de energia e água.',
      '',
      this.closing(score, responseContext),
      '',
      'Como a leitura foi feita pela imagem, as quantidades são estimadas e podem variar.',
    ]
      .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
      .join('\n');
  }

  private opening(
    analysis: NutritionResponseAnalysis,
    context: NutritionResponseContext,
  ): string {
    const meal = this.categoryLabel(analysis.mealCategory);
    const goal = this.goalLabel(context.context.goal);
    if (analysis.items.length === 1) {
      return `Pela foto, identifiquei ${analysis.items[0]?.foodName} no seu ${meal}. Vamos olhar como essa escolha conversa com seu objetivo de ${goal}.`;
    }
    if (analysis.items.length > 1) {
      return `Pela foto, identifiquei alguns itens no seu ${meal}. Vou te mostrar o principal para o seu objetivo de ${goal}.`;
    }
    return `Recebi a foto do seu ${meal}. Mesmo sem separar todos os itens, consigo te orientar pelo que foi estimado.`;
  }

  private qualityMeaning(score: number | undefined): string {
    if (score === undefined)
      return 'Ainda não há informação suficiente para avaliar o equilíbrio da refeição.';
    if (score >= 80)
      return 'A refeição tem uma base nutricional bem equilibrada e vale repetir essa lógica.';
    if (score >= 60)
      return 'A refeição tem uma boa base; um ajuste pequeno pode deixá-la mais completa.';
    if (score >= 40)
      return 'A refeição cobre parte do que você precisa, mas pode ganhar mais equilíbrio com uma mudança simples.';
    return 'Essa escolha teve pouco valor nutricional sozinha. Tudo bem: a próxima refeição pode equilibrar o dia com proteína e fibras.';
  }

  private goalImpact(
    goal: FitnessGoal | null,
    quality: NutritionResponseAnalysis['qualityScore'],
    protein: number,
  ): string {
    const label = this.goalLabel(goal);
    if (!quality)
      return `Vou considerar esta refeição no acompanhamento do seu objetivo de ${label}.`;
    if (goal === FitnessGoal.MUSCLE_GAIN && quality.proteinScore < 60) {
      return `Para ${label}, os ${this.formatNumber(protein)}g de proteína podem ficar melhores com uma fonte proteica mais presente na próxima refeição.`;
    }
    if (goal === FitnessGoal.WEIGHT_LOSS && quality.fiberScore < 60) {
      return `Para ${label}, incluir mais fibras ou vegetais pode ajudar na saciedade sem complicar a refeição.`;
    }
    return `Para ${label}, o melhor caminho é manter o que funcionou aqui e ajustar apenas o ponto menos completo.`;
  }

  private trendMeaning(
    trend: { direction: string } | undefined,
    recentMealCount: number,
  ): string {
    if (!trend) {
      return recentMealCount > 0
        ? 'Cada novo registro ajuda a entender melhor o que funciona na sua rotina.'
        : 'Esta refeição começa a formar um histórico para orientações mais conectadas à sua rotina.';
    }
    if (trend.direction === 'IMPROVING')
      return 'Suas escolhas recentes mostram evolução; vale manter o que está sendo fácil repetir.';
    if (trend.direction === 'DECLINING')
      return 'Suas escolhas oscilaram um pouco nos últimos dias, então vamos priorizar um passo simples e repetível.';
    return 'Suas escolhas recentes estão estáveis; agora um ajuste pequeno pode destravar a próxima evolução.';
  }

  private rhythmMeaning(
    coach: CoachResponseSignals,
    behavior: BehavioralSignals,
  ): string {
    if (coach.churnRisk === 'HIGH' || coach.experience.momentum.score < 40)
      return 'Seu ritmo caiu um pouco, então não precisamos aumentar a cobrança: vamos recuperar a constância com um passo menor.';
    if (coach.churnRisk === 'MEDIUM' || behavior.adherenceScore < 60)
      return 'Sua rotina ainda oscila, e por isso uma mudança fácil de repetir vale mais do que tentar acertar tudo de uma vez.';
    return 'Você vem mantendo continuidade; preserve o básico que já funciona antes de acrescentar novas mudanças.';
  }

  private closing(
    score: number | undefined,
    context: NutritionResponseContext,
  ): string {
    if (context.coach.experience.fatigue.score >= 70)
      return 'Para não sobrecarregar, escolha só uma ação desta análise para testar na próxima refeição.';
    if (context.behavior.stage === 'CONTEMPLATION')
      return 'Sem cobrança: escolha apenas uma mudança que faça sentido experimentar.';
    if (score !== undefined && score >= 80)
      return 'Essa base está funcionando. Quer que eu te ajude a pensar em outra refeição seguindo a mesma lógica?';
    return 'Quer que eu te sugira uma opção prática para equilibrar a próxima refeição?';
  }

  private goalLabel(goal: FitnessGoal | null): string {
    if (goal === FitnessGoal.MUSCLE_GAIN) return 'ganho de massa';
    if (goal === FitnessGoal.WEIGHT_LOSS) return 'emagrecimento';
    return 'manutenção';
  }

  private categoryLabel(category: MealCategory): string {
    const labels: Record<MealCategory, string> = {
      [MealCategory.BREAKFAST]: 'café da manhã',
      [MealCategory.LUNCH]: 'almoço',
      [MealCategory.DINNER]: 'jantar',
      [MealCategory.SNACK]: 'lanche',
      [MealCategory.UNKNOWN]: 'registro',
    };
    return labels[category];
  }

  private requireTotals(analysis: NutritionResponseAnalysis) {
    if (
      !analysis.totalCalories ||
      !analysis.totalProtein ||
      !analysis.totalCarbs ||
      !analysis.totalFat
    ) {
      throw new Error('Análise nutricional concluída sem totais');
    }
    return {
      calories: analysis.totalCalories.toNumber(),
      protein: analysis.totalProtein.toNumber(),
      carbs: analysis.totalCarbs.toNumber(),
      fat: analysis.totalFat.toNumber(),
    };
  }

  private foodEmoji(foodName: string): string {
    const normalized = foodName
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR');
    if (normalized.includes('arroz')) return '🍚';
    if (normalized.includes('feijao')) return '🫘';
    if (/frango|carne|peixe|ovo/u.test(normalized)) return '🥩';
    if (/suco|agua|cafe|refrigerante/u.test(normalized)) return '🥤';
    return '🍽️';
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
      maximumFractionDigits: 1,
    }).format(value);
  }

  private isPublicText(value: string): boolean {
    return !/(?:\bscore\b|\bíndice\b|\bconfidence\b|\bmomentum\b|\bretention\b|\brisk\b|\d+\s*\/\s*100)/iu.test(
      value,
    );
  }
}
