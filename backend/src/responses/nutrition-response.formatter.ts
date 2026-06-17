import { Injectable } from '@nestjs/common';
import { FitnessGoal, MealCategory } from '@prisma/client';
import { NutritionUserContext } from '../nutrition/interfaces/nutrition-context.interface';
import { CoachResponseSignals } from '../automation/interfaces/coach-context.interface';
import { BehavioralSignals } from '../behavior/interfaces/behavioral.interface';
import { LongitudinalResponseContext } from '../longitudinal/interfaces/longitudinal.interface';

export interface NutritionResponseItem {
  foodName: string;
  estimatedGrams: {
    toNumber(): number;
  };
}

export interface NutritionResponseAnalysis {
  totalCalories: {
    toNumber(): number;
  } | null;
  totalProtein: {
    toNumber(): number;
  } | null;
  totalCarbs: {
    toNumber(): number;
  } | null;
  totalFat: {
    toNumber(): number;
  } | null;
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
    const itemLines = displayedItems.map(
      (item) =>
        `${this.foodEmoji(item.foodName)} ${item.foodName} (${this.formatNumber(item.estimatedGrams.toNumber())}g)`,
    );

    if (analysis.items.length > itemLimit) {
      itemLines.push(
        `• E mais ${analysis.items.length - itemLimit} item(ns) identificado(s)`,
      );
    }

    const score = analysis.qualityScore?.score;
    const activeInsight = responseContext.context.activeInsights[0];
    const trend = responseContext.context.trends.find(
      (item) => item.windowDays === 7,
    );
    const recommendation = responseContext.recommendations[0];

    return [
      this.personalizedOpening(responseContext),
      '',
      `Observação da refeição (${this.categoryLabel(analysis.mealCategory)}):`,
      '',
      ...(itemLines.length > 0
        ? itemLines
        : ['• Não foi possível separar os itens do prato']),
      '',
      'Resumo nutricional:',
      '',
      `🔥 Calorias: ${this.formatNumber(totals.calories)} kcal`,
      `🥩 Proteínas: ${this.formatNumber(totals.protein)}g`,
      `🍞 Carboidratos: ${this.formatNumber(totals.carbs)}g`,
      `🥑 Gorduras: ${this.formatNumber(totals.fat)}g`,
      '',
      `Qualidade nutricional: ${score ?? 'em cálculo'}/100`,
      this.foodQualityIndex(responseContext),
      '',
      'Evidência nutricional:',
      this.evidenceContext(responseContext),
      '',
      'Impacto no seu objetivo:',
      this.goalImpact(
        responseContext.context.goal,
        analysis.qualityScore,
        totals.protein,
      ),
      '',
      'Insight contextual:',
      activeInsight
        ? `${activeInsight.title}. ${activeInsight.summary}`
        : this.trendInsight(trend, responseContext.context.recentMeals.length),
      '',
      'Recomendação prática:',
      recommendation
        ? `${recommendation.title}: ${recommendation.action}`
        : 'Mantenha uma estrutura simples com proteína, vegetais ou fibras, uma fonte de energia e água.',
      '',
      'Seu ritmo:',
      this.coachRhythm(responseContext.coach),
      '',
      'Motivação:',
      this.motivationContext(responseContext.coach),
      '',
      'Acompanhamento comportamental:',
      this.behavioralContext(responseContext.behavior),
      '',
      'Evolução longitudinal:',
      this.longitudinalContext(responseContext.longitudinal),
      this.adaptiveEvolutionContext(responseContext),
      '',
      this.humanClosing(score, responseContext),
      '',
      'Estimativa baseada em visão computacional. As quantidades podem variar.',
    ].join('\n');
  }

  private goalImpact(
    goal: FitnessGoal | null,
    score: NutritionResponseAnalysis['qualityScore'],
    protein: number,
  ): string {
    const goalLabel =
      goal === FitnessGoal.MUSCLE_GAIN
        ? 'ganho de massa'
        : goal === FitnessGoal.WEIGHT_LOSS
          ? 'redução de peso'
          : 'manutenção';

    if (!score) {
      return `A refeição será acompanhada dentro do seu objetivo de ${goalLabel} assim que o score estiver disponível.`;
    }

    if (goal === FitnessGoal.MUSCLE_GAIN && score.proteinScore < 60) {
      return `Para seu objetivo de ${goalLabel}, os ${this.formatNumber(protein)}g de proteína ficaram abaixo do padrão esperado para esta refeição.`;
    }

    if (goal === FitnessGoal.WEIGHT_LOSS && score.fiberScore < 60) {
      return `Para seu objetivo de ${goalLabel}, aumentar fibras e vegetais pode melhorar saciedade e equilíbrio da refeição.`;
    }

    return `A aderência estimada ao seu objetivo de ${goalLabel} foi ${score.goalAdherenceScore}/100; o melhor próximo passo é preservar o que funcionou e ajustar apenas o ponto mais fraco.`;
  }

  private trendInsight(
    trend:
      | {
          direction: string;
          averageQualityScore: number;
          consistencyScore: number;
        }
      | undefined,
    recentMealCount: number,
  ): string {
    if (!trend) {
      return `Esta análise começa a formar seu histórico personalizado; já há ${recentMealCount} refeição(ões) recente(s) disponível(is) para comparação.`;
    }

    const direction =
      trend.direction === 'IMPROVING'
        ? 'está melhorando'
        : trend.direction === 'DECLINING'
          ? 'caiu recentemente'
          : 'permanece estável';

    return `Nos últimos 7 dias, sua qualidade média ${direction}, com média ${trend.averageQualityScore}/100 e consistência ${trend.consistencyScore}/100.`;
  }

  private humanClosing(
    score: number | undefined,
    context: NutritionResponseContext,
  ): string {
    const behavior = context.behavior;

    if (context.coach.experience.fatigue.score >= 70) {
      return 'Para não sobrecarregar: escolha somente uma ação desta análise para testar na próxima refeição.';
    }

    if (context.coach.experience.momentum.score < 40) {
      return 'Seu momentum está baixo agora; o melhor resultado é recuperar uma ação simples, não tentar corrigir tudo.';
    }

    if (behavior.stage === 'CONTEMPLATION') {
      return 'Sem cobrança: escolha apenas uma mudança que faça sentido para você experimentar.';
    }

    if (behavior.stage === 'PREPARATION') {
      return 'Você já está preparando a mudança. Defina uma ação pequena e específica para a próxima refeição.';
    }

    if (score === undefined) {
      return 'Vamos usar as próximas refeições para tornar esse acompanhamento cada vez mais preciso.';
    }

    if (score >= 80) {
      return 'A base desta refeição está forte. Vale repetir essa lógica em dias corridos.';
    }

    if (score >= 60) {
      return 'A refeição tem uma boa base e um ajuste pequeno já pode elevar bastante a qualidade.';
    }

    return 'Sem julgamento: escolha apenas uma melhoria prática para a próxima refeição semelhante.';
  }

  private behavioralOpening(behavior: BehavioralSignals): string {
    switch (behavior.communicationStyle) {
      case 'DIRECT':
        return 'Direto ao ponto: esta é a leitura mais útil da sua refeição.';
      case 'ANALYTICAL':
        return 'Leitura orientada por dados, comparada ao seu momento atual.';
      case 'COACH':
        return 'Vamos transformar esta análise em uma ação possível.';
      case 'MOTIVATIONAL':
        return 'Cada registro ajuda a tornar seu progresso mais consciente.';
      case 'FRIENDLY':
        return 'Aqui está uma leitura prática e personalizada da sua refeição.';
    }
  }

  private personalizedOpening(context: NutritionResponseContext): string {
    const adaptiveProfile = context.coach.adaptive.communication.profile;

    if (adaptiveProfile === 'EXECUTIVE') {
      return `Resumo objetivo para ${this.coachGoalLabel(context.coach.goal)}: qualidade, principal fator e próxima ação.`;
    }

    if (adaptiveProfile === 'TECHNICAL') {
      return `Leitura baseada em seis dimensões nutricionais e no histórico de ${context.coach.adaptive.nutritionEvidence.mealsAnalyzed} refeição(ões).`;
    }

    if (adaptiveProfile === 'DISCIPLINED') {
      return 'Leitura prática: um indicador, um ponto de atenção e uma ação para repetir.';
    }

    if (adaptiveProfile === 'WARM') {
      return 'Aqui está uma leitura baseada no seu histórico, sem julgamento e com um ajuste possível.';
    }

    if (adaptiveProfile === 'INSPIRATIONAL') {
      return 'Seu histórico transforma esta refeição em um próximo passo mais inteligente.';
    }

    const profile = context.coach.experience.communication.dominantStyle;

    if (profile === 'TECHNICAL') {
      return `Leitura técnica e comparativa para seu objetivo de ${this.coachGoalLabel(context.coach.goal)}.`;
    }

    if (profile === 'DISCIPLINARIAN') {
      return 'Vamos transformar esta análise em uma ação objetiva para a próxima refeição.';
    }

    if (profile === 'WARM') {
      return 'Aqui está uma leitura sem julgamento, conectada ao seu momento atual.';
    }

    if (profile === 'MOTIVATIONAL') {
      return 'Esta refeição traz uma oportunidade concreta de manter seu processo em movimento.';
    }

    return this.behavioralOpening(context.behavior);
  }

  private behavioralContext(behavior: BehavioralSignals): string {
    const stageLabels: Record<string, string> = {
      PRE_CONTEMPLATION: 'observação',
      CONTEMPLATION: 'reflexão',
      PREPARATION: 'preparação',
      ACTION: 'ação',
      MAINTENANCE: 'manutenção',
    };

    return `Estágio de ${stageLabels[behavior.stage] ?? 'ação'}, adesão prevista ${behavior.adherenceScore}/100 e motivação predominante ${behavior.motivationStyle.toLocaleLowerCase('pt-BR')}.`;
  }

  private coachRhythm(coach: CoachResponseSignals): string {
    const risk =
      coach.churnRisk === 'HIGH'
        ? 'Seu ritmo caiu recentemente, então o foco agora é uma retomada simples.'
        : coach.churnRisk === 'MEDIUM'
          ? 'Há sinais de oscilação; preservar a próxima ação é mais importante que buscar perfeição.'
          : 'Seu acompanhamento está ativo e o foco é manter continuidade.';

    return `Consistência ${coach.consistencyScore}/100, engajamento ${coach.engagementScore}/100, momentum ${coach.experience.momentum.score}/100 e retenção ${coach.experience.retention.score}/100. ${risk}`;
  }

  private motivationContext(coach: CoachResponseSignals): string {
    const lines: Record<string, string> = {
      VISUAL_RESULT:
        'Use escolhas repetíveis para tornar a evolução mais visível.',
      HEALTH: 'Priorize uma ação que proteja energia e saúde no dia real.',
      SELF_ESTEEM: 'Cumprir um passo pequeno reforça confiança no processo.',
      PERFORMANCE: 'A próxima escolha pode apoiar desempenho e recuperação.',
      DISCIPLINE:
        'Disciplina significa repetir o básico mesmo em dias imperfeitos.',
      LONGEVITY:
        'O melhor ajuste é aquele que continua funcionando no longo prazo.',
      ROUTINE: 'Conecte a ação ao horário em que sua rotina já acontece.',
    };

    return (
      lines[coach.experience.motivation.dominantTrigger] ?? coach.motivation
    );
  }

  private longitudinalContext(context: LongitudinalResponseContext): string {
    const progression = context.goalProgression
      ? `progressão ${context.goalProgression.score}/100 (${this.directionLabel(context.goalProgression.state)})`
      : 'progressão ainda em formação';
    const evolution = context.evolution
      ? `evolução geral ${this.directionLabel(context.evolution.overallDirection)}`
      : 'evolução ainda sem janela comparável';
    const relapse = context.relapse
      ? ` Há recaída ${context.relapse.severity.toLocaleLowerCase('pt-BR')}; o foco é recuperação gradual.`
      : '';
    const preference = context.preferences[0]
      ? ` A preferência mais confiável é ${context.preferences[0].foodName} (${Math.round(context.preferences[0].confidence * 100)}%).`
      : '';

    return `${evolution}, ${progression}.${relapse}${preference}`;
  }

  private foodQualityIndex(context: NutritionResponseContext): string {
    const quality = context.coach.adaptive.foodQuality;

    if (!quality) {
      return 'Índice alimentar ainda em formação.';
    }

    const labels: Record<string, string> = {
      EXCELLENT: 'excelente',
      GOOD: 'boa',
      REGULAR: 'regular',
      POOR: 'baixa',
    };

    return `Classificação ${labels[quality.qualityClass]}: ${quality.explanation}`;
  }

  private evidenceContext(context: NutritionResponseContext): string {
    const evidence = context.coach.adaptive.nutritionEvidence;
    const pattern = context.coach.adaptive.dietaryPatterns[0];
    const patternLabels: Record<string, string> = {
      HIGH_PROTEIN: 'alta presença de proteína',
      LOW_PROTEIN: 'baixa presença de proteína',
      EXCESS_SUGAR: 'açúcar elevado',
      HIGH_ULTRA_PROCESSED: 'ultraprocessados elevados',
      LOW_HYDRATION: 'baixa hidratação',
      LOW_VARIETY: 'baixa variedade alimentar',
      BALANCED: 'alimentação equilibrada',
    };

    return `Score ${evidence.score}/100: vegetais ${evidence.vegetableScore}, proteína ${evidence.proteinScore}, fibras ${evidence.fiberScore}, hidratação ${evidence.hydrationScore}, açúcar ${evidence.sugarScore} e ultraprocessados ${evidence.ultraProcessedScore}.${pattern ? ` Padrão mais provável: ${patternLabels[pattern.pattern]} (${Math.round(pattern.confidence * 100)}%).` : ''}`;
  }

  private adaptiveEvolutionContext(context: NutritionResponseContext): string {
    const evolution = context.coach.adaptive.evolution
      .map(
        (item) =>
          `${item.windowDays} dias ${this.directionLabel(item.direction)} (${item.score}/100)`,
      )
      .join('; ');
    const learning = context.coach.adaptive.learning;
    const preferred = learning.preferredTopics[0];
    const avoided = learning.ignoredTopics[0];

    return ` Comparação adaptativa: ${evolution || 'histórico em formação'}. O aprendizado ${preferred ? `prioriza ${this.topicLabel(preferred)}` : 'ainda está formando preferências'}${avoided ? ` e reduz recorrência de ${this.topicLabel(avoided)}` : ''}. Risco precoce de abandono: ${this.churnLevelLabel(context.coach.adaptive.earlyChurn.level)} (${context.coach.adaptive.earlyChurn.score}/100).`;
  }

  private topicLabel(topic: string): string {
    const labels: Record<string, string> = {
      protein: 'proteína',
      hydration: 'hidratação',
      breakfast: 'café da manhã',
      nutrition: 'nutrição',
      habit: 'hábitos',
      behavior: 'comportamento',
      engagement: 'engajamento',
      retention: 'retenção',
      coaching: 'coach',
    };

    return labels[topic] ?? topic.replaceAll('_', ' ');
  }

  private churnLevelLabel(level: string): string {
    const labels: Record<string, string> = {
      LOW: 'baixo',
      MEDIUM: 'médio',
      HIGH: 'alto',
      CRITICAL: 'crítico',
    };

    return labels[level] ?? level.toLocaleLowerCase('pt-BR');
  }

  private coachGoalLabel(goal: string): string {
    const labels: Record<string, string> = {
      WEIGHT_LOSS: 'emagrecimento',
      HYPERTROPHY: 'hipertrofia',
      MAINTENANCE: 'manutenção',
      HEALTH: 'saúde',
    };

    return labels[goal] ?? 'evolução nutricional';
  }

  private directionLabel(direction: string): string {
    const labels: Record<string, string> = {
      IMPROVING: 'em melhora',
      STABLE: 'estável',
      DECLINING: 'em queda',
    };

    return labels[direction] ?? direction.toLocaleLowerCase('pt-BR');
  }

  private categoryLabel(category: MealCategory): string {
    const labels: Record<MealCategory, string> = {
      [MealCategory.BREAKFAST]: 'café da manhã',
      [MealCategory.LUNCH]: 'almoço',
      [MealCategory.DINNER]: 'jantar',
      [MealCategory.SNACK]: 'lanche',
      [MealCategory.UNKNOWN]: 'horário não identificado',
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
      .toLowerCase();

    if (normalized.includes('arroz')) {
      return '🍚';
    }

    if (normalized.includes('feijao')) {
      return '🫘';
    }

    if (
      normalized.includes('frango') ||
      normalized.includes('carne') ||
      normalized.includes('peixe') ||
      normalized.includes('ovo')
    ) {
      return '🥩';
    }

    if (
      normalized.includes('suco') ||
      normalized.includes('agua') ||
      normalized.includes('cafe') ||
      normalized.includes('refrigerante')
    ) {
      return '🥤';
    }

    return '🍽️';
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
      maximumFractionDigits: 1,
    }).format(value);
  }
}
