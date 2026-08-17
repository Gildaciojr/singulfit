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
        `${this.foodEmoji(item.foodName)} ${item.foodName}, ~${this.formatNumber(item.estimatedGrams.toNumber())} g`,
    );
    if (analysis.items.length > itemLimit) {
      foods.push(
        `• E mais ${analysis.items.length - itemLimit} item(ns) identificado(s)`,
      );
    }

    const recommendation = responseContext.recommendations[0];

    return [
      this.opening(analysis),
      '',
      ...(foods.length > 0
        ? foods
        : ['Não consegui separar com segurança os itens da imagem.']),
      '',
      `Estimativa: ${this.formatNumber(totals.calories)} kcal — ${this.formatNumber(totals.protein)} g de proteína, ${this.formatNumber(totals.carbs)} g de carboidratos e ${this.formatNumber(totals.fat)} g de gorduras.`,
      '',
      this.goalAssessment(
        responseContext.context.goal,
        analysis.qualityScore,
        totals.protein,
      ),
      recommendation?.action,
      '',
      'Valores estimados pela imagem e podem variar.',
    ]
      .filter(
        (line, index, lines): line is string =>
          line !== undefined && (line !== '' || lines[index - 1] !== ''),
      )
      .join('\n');
  }

  private opening(analysis: NutritionResponseAnalysis): string {
    const meal = this.categoryLabel(analysis.mealCategory);
    return analysis.items.length > 0
      ? `Pela foto, identifiquei no seu ${meal}:`
      : `Pela foto do seu ${meal}:`;
  }

  private goalAssessment(
    goal: FitnessGoal | null,
    quality: NutritionResponseAnalysis['qualityScore'],
    protein: number,
  ): string {
    const label = this.goalLabel(goal);
    if (!quality) return `Estimativa registrada para seu objetivo de ${label}.`;
    if (goal === FitnessGoal.MUSCLE_GAIN && quality.proteinScore < 60) {
      return `Para ${label}, o aporte de ${this.formatNumber(protein)} g de proteína ficou baixo.`;
    }
    if (goal === FitnessGoal.WEIGHT_LOSS && quality.fiberScore < 60) {
      return `Para ${label}, a composição pode ganhar mais fibras para favorecer a saciedade.`;
    }
    if (quality.score >= 80 && quality.proteinScore >= 60) {
      return `Boa composição para seu objetivo de ${label}, com bom aporte de proteína.`;
    }
    if (quality.score >= 60) {
      return `Composição adequada para seu objetivo de ${label}.`;
    }
    return `A composição pode ser ajustada para apoiar melhor seu objetivo de ${label}.`;
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
}
