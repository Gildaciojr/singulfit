import type { ConversationGoal } from '../../context/conversation-goal-planner.contract';
import type {
  NutritionReasoningObjective,
  NutritionReasoningStrategy,
} from '../../nutrition-reasoning/nutrition-reasoning.contract';
import type {
  WorkoutReasoningObjective,
  WorkoutReasoningStrategy,
} from '../../workout-reasoning/workout-reasoning.contract';
import type {
  ConversationReasoningBridgeInput,
  ConversationReasoningLongitudinalEvidence,
  ConversationReasoningStrategyEvidence,
  ConversationReasoningSummary,
} from './conversation-reasoning-bridge.contract';

const GOAL_LABELS: Readonly<Partial<Record<ConversationGoal, string>>> =
  Object.freeze({
    ANSWER_MESSAGE: 'responder à mensagem atual',
    ASK_PROFILE_INFORMATION: 'completar uma informação necessária',
    GENERATE_DIET_PLAN: 'criar um plano alimentar',
    GENERATE_WORKOUT_PLAN: 'criar um plano de treino',
    GENERATE_COMBINED_PLANS: 'criar planos de alimentação e treino',
    UPDATE_DIET_PLAN: 'ajustar o plano alimentar',
    UPDATE_WORKOUT_PLAN: 'ajustar o plano de treino',
    REVIEW_PROGRESS: 'revisar o progresso',
    REQUEST_CONFIRMATION: 'confirmar o próximo passo',
    SHOW_CURRENT_PLAN: 'apresentar o plano atual',
    SHOW_PLAN_STATUS: 'informar o andamento do plano',
    GENERAL_GUIDANCE: 'oferecer uma orientação prática',
  });

const NUTRITION_OBJECTIVES: Readonly<
  Record<NutritionReasoningObjective, string>
> = Object.freeze({
  SAFETY: 'preservar segurança',
  WEIGHT_REDUCTION: 'apoiar redução de peso',
  MUSCLE_DEVELOPMENT: 'apoiar desenvolvimento muscular',
  WEIGHT_MAINTENANCE: 'manter o equilíbrio atual',
  ADHERENCE: 'facilitar continuidade',
  PERFORMANCE: 'apoiar desempenho',
  RECOVERY: 'favorecer recuperação',
  SATIETY: 'melhorar saciedade',
  PRACTICALITY: 'simplificar a rotina alimentar',
  ECONOMY: 'adequar escolhas ao orçamento',
  NUTRITION_EDUCATION: 'aumentar autonomia alimentar',
});

const WORKOUT_OBJECTIVES: Readonly<Record<WorkoutReasoningObjective, string>> =
  Object.freeze({
    SAFETY: 'preservar segurança no treino',
    HYPERTROPHY: 'apoiar hipertrofia',
    STRENGTH: 'desenvolver força',
    MUSCULAR_ENDURANCE: 'desenvolver resistência muscular',
    MAINTENANCE: 'manter a capacidade atual',
    CONDITIONING: 'melhorar condicionamento',
    ENDURANCE: 'desenvolver resistência',
    MOBILITY: 'melhorar mobilidade',
    ACTIVE_RECOVERY: 'favorecer recuperação ativa',
    ADHERENCE: 'facilitar consistência no treino',
    EDUCATION: 'aumentar autonomia no treino',
  });

const NUTRITION_STRATEGIES: Readonly<
  Partial<
    Record<NutritionReasoningStrategy, ConversationReasoningStrategyEvidence>
  >
> = Object.freeze({
  ENERGY_BALANCE: {
    name: 'equilíbrio energético',
    purpose: 'alinhar ingestão e objetivo sem medidas extremas',
  },
  PROTEIN_PRIORITY: {
    name: 'prioridade de proteína',
    purpose: 'apoiar saciedade, recuperação e manutenção muscular',
  },
  PROTEIN_DISTRIBUTION: {
    name: 'proteína distribuída ao longo do dia',
    purpose: 'tornar o consumo proteico mais regular',
  },
  ENERGY_DENSITY: {
    name: 'ajuste da densidade energética',
    purpose:
      'adequar energia sem ampliar desnecessariamente o volume alimentar',
  },
  SATIETY_SUPPORT: {
    name: 'suporte à saciedade',
    purpose: 'facilitar controle da fome e continuidade',
  },
  PRACTICAL_MEALS: {
    name: 'refeições práticas',
    purpose: 'reduzir atrito na rotina',
  },
  QUICK_MEALS: {
    name: 'preparações rápidas',
    purpose: 'manter uma alimentação viável quando há pouco tempo',
  },
  CONTROLLED_VARIETY: {
    name: 'variedade controlada',
    purpose: 'equilibrar diversidade e simplicidade',
  },
  RECOVERY_SUPPORT: {
    name: 'suporte à recuperação',
    purpose: 'favorecer recuperação entre sessões',
  },
  HYDRATION_SUPPORT: {
    name: 'suporte à hidratação',
    purpose: 'preservar regularidade hídrica',
  },
  SPORTS_FUELING: {
    name: 'energia para o treino',
    purpose: 'apoiar desempenho e recuperação',
  },
  FOOD_SUBSTITUTION: {
    name: 'substituições equivalentes',
    purpose: 'preservar o objetivo com escolhas mais viáveis',
  },
  NUTRITION_EDUCATION: {
    name: 'educação nutricional',
    purpose: 'aumentar autonomia nas escolhas',
  },
  ECONOMIC_SELECTION: {
    name: 'seleção econômica',
    purpose: 'priorizar opções acessíveis com função semelhante',
  },
  ROUTINE_ALIGNMENT: {
    name: 'alinhamento com a rotina',
    purpose: 'encaixar a orientação no dia real',
  },
  EATING_OUT_NAVIGATION: {
    name: 'escolhas fora de casa',
    purpose: 'manter consistência em restaurantes e refeições externas',
  },
  BEHAVIOR_ADHERENCE: {
    name: 'apoio à aderência',
    purpose: 'priorizar ações sustentáveis',
  },
  CONSTRAINT_PRESERVATION: {
    name: 'preservação das restrições',
    purpose: 'evitar escolhas incompatíveis com os limites informados',
  },
});

const WORKOUT_STRATEGIES: Readonly<
  Partial<
    Record<WorkoutReasoningStrategy, ConversationReasoningStrategyEvidence>
  >
> = Object.freeze({
  TECHNIQUE_PRIORITY: {
    name: 'técnica antes da intensidade',
    purpose: 'melhorar execução com menor risco',
  },
  CONSERVATIVE_PROGRESSION: {
    name: 'progressão conservadora',
    purpose: 'evoluir sem saltos desnecessários',
  },
  SINGLE_VARIABLE_PROGRESSION: {
    name: 'progressão de uma variável por vez',
    purpose: 'tornar a evolução controlável',
  },
  MAINTENANCE: {
    name: 'manutenção do estímulo',
    purpose: 'preservar capacidade antes de novo avanço',
  },
  REGRESSION: {
    name: 'regressão planejada',
    purpose: 'adequar o exercício ao momento atual',
  },
  DELOAD: {
    name: 'redução temporária de carga',
    purpose: 'favorecer recuperação',
  },
  REASSESSMENT: {
    name: 'reavaliação',
    purpose: 'confirmar condições antes de progredir',
  },
  SIMPLE_SESSION: {
    name: 'sessão simples',
    purpose: 'reduzir complexidade e facilitar execução',
  },
  SUSTAINABLE_FREQUENCY: {
    name: 'frequência sustentável',
    purpose: 'favorecer consistência',
  },
  REDUCED_DURATION: {
    name: 'duração reduzida',
    purpose: 'encaixar o treino no tempo disponível',
  },
  CONTROLLED_VOLUME: {
    name: 'volume controlado',
    purpose: 'equilibrar estímulo e recuperação',
  },
  ACTIVE_RECOVERY: {
    name: 'recuperação ativa',
    purpose: 'manter movimento com baixa exigência',
  },
  REQUIRED_WARM_UP: {
    name: 'aquecimento',
    purpose: 'preparar o corpo para a sessão',
  },
  REQUIRED_MOBILITY: {
    name: 'mobilidade preparatória',
    purpose: 'apoiar execução confortável',
  },
  REQUIRED_COOLDOWN: {
    name: 'retorno gradual ao repouso',
    purpose: 'encerrar a sessão de forma progressiva',
  },
  SIMPLE_SPLIT: {
    name: 'divisão simples',
    purpose: 'facilitar entendimento e continuidade',
  },
  BASIC_MOVEMENTS: {
    name: 'movimentos fundamentais',
    purpose: 'construir uma base consistente',
  },
  EXECUTION_BASED_PROGRESSION: {
    name: 'progressão pela qualidade da execução',
    purpose: 'avançar quando o movimento estiver consistente',
  },
  GRADUAL_RUNNING_ADAPTATION: {
    name: 'adaptação gradual à corrida',
    purpose: 'construir tolerância progressivamente',
  },
  RUN_WALK: {
    name: 'alternância entre corrida e caminhada',
    purpose: 'adequar esforço e continuidade',
  },
  BETWEEN_SESSION_RECOVERY: {
    name: 'recuperação entre sessões',
    purpose: 'evitar acúmulo desnecessário de fadiga',
  },
  REQUIRED_SCALING: {
    name: 'ajuste de escala',
    purpose: 'adequar o treino à experiência atual',
  },
  TECHNIQUE_BEFORE_INTENSITY: {
    name: 'técnica antes da intensidade',
    purpose: 'preservar qualidade antes de aumentar exigência',
  },
  LOW_FRICTION: {
    name: 'treino de baixo atrito',
    purpose: 'facilitar início e consistência',
  },
  SHORT_SESSIONS: {
    name: 'sessões curtas',
    purpose: 'manter regularidade com pouco tempo',
  },
  REDUCED_COMPLEXITY: {
    name: 'complexidade reduzida',
    purpose: 'tornar o plano mais executável',
  },
  TRAINING_EDUCATION: {
    name: 'educação sobre treino',
    purpose: 'aumentar autonomia e qualidade de execução',
  },
  SUSTAINABLE_MOTIVATION: {
    name: 'motivação sustentável',
    purpose: 'apoiar continuidade sem pressão exagerada',
  },
  EQUIPMENT_COMPATIBILITY: {
    name: 'compatibilidade com equipamentos',
    purpose: 'usar somente recursos disponíveis',
  },
  ENVIRONMENT_COMPATIBILITY: {
    name: 'compatibilidade com o ambiente',
    purpose: 'adequar o treino ao local disponível',
  },
});

export function nutritionObjectiveLabel(
  objective: NutritionReasoningObjective,
): string {
  return NUTRITION_OBJECTIVES[objective];
}

export function workoutObjectiveLabel(
  objective: WorkoutReasoningObjective,
): string {
  return WORKOUT_OBJECTIVES[objective];
}

export function nutritionStrategyEvidence(
  strategy: NutritionReasoningStrategy,
): ConversationReasoningStrategyEvidence | null {
  return NUTRITION_STRATEGIES[strategy] ?? null;
}

export function workoutStrategyEvidence(
  strategy: WorkoutReasoningStrategy,
): ConversationReasoningStrategyEvidence | null {
  return WORKOUT_STRATEGIES[strategy] ?? null;
}

export class ConversationReasoningSummaryBuilder {
  build(input: ConversationReasoningBridgeInput): ConversationReasoningSummary {
    const goal = input.planner
      ? (GOAL_LABELS[input.planner.goal] ?? null)
      : null;
    const nutritionObjective = input.nutrition?.prioritizedObjectives.find(
      (objective) => objective.primary,
    )?.objective;
    const decision = nutritionObjective
      ? nutritionObjectiveLabel(nutritionObjective)
      : input.workout
        ? workoutObjectiveLabel(input.workout.primaryObjective)
        : this.longitudinalDecision(input);
    const expectedBenefit = input.nutrition
      ? this.nutritionBenefit(input.nutrition.interventionIntensity)
      : input.workout
        ? this.workoutBenefit(input.workout.progressionDecision)
        : null;

    return Object.freeze({ goal, decision, expectedBenefit });
  }

  longitudinal(
    input: ConversationReasoningBridgeInput,
  ): ConversationReasoningLongitudinalEvidence {
    if (input.longitudinal) {
      return Object.freeze({
        continuity: this.longitudinalDecision(input),
        progress: this.progressLabel(input.longitudinal.currentState),
        adherence: this.adherenceLabel(
          input.longitudinal.adherence.level,
          input.longitudinal.adherence.trend,
        ),
        repetitionRisk: input.longitudinal.rationaleCodes.includes(
          'REPEATED_ADAPTATION',
        ),
      });
    }
    const context = input.longitudinalContext;
    if (!context)
      return Object.freeze({
        continuity: null,
        progress: null,
        adherence: null,
        repetitionRisk: false,
      });
    return Object.freeze({
      continuity: context.coachAdaptation
        ? this.adaptationLabel(context.coachAdaptation.mode)
        : null,
      progress: context.goalProgression
        ? `O progresso do objetivo está em ${this.lowerLabel(context.goalProgression.state)}.`
        : context.evolution
          ? `A evolução recente está ${this.lowerLabel(context.evolution.overallDirection)}.`
          : null,
      adherence: context.profile
        ? context.profile.adherenceScore >= 70
          ? 'A aderência observada está consistente.'
          : context.profile.adherenceScore >= 45
            ? 'A aderência observada está oscilante.'
            : 'A aderência observada pede um próximo passo mais simples.'
        : null,
      repetitionRisk: false,
    });
  }

  strategies(
    input: ConversationReasoningBridgeInput,
  ): readonly ConversationReasoningStrategyEvidence[] {
    const candidates = [
      ...(input.nutrition?.selectedStrategies.map((item) =>
        nutritionStrategyEvidence(item.strategy),
      ) ?? []),
      ...(input.workout?.selectedStrategies.map((item) =>
        workoutStrategyEvidence(item.strategy),
      ) ?? []),
    ].filter(
      (item): item is ConversationReasoningStrategyEvidence => item !== null,
    );
    const unique = new Map(candidates.map((item) => [item.name, item]));
    return Object.freeze(
      [...unique.values()].slice(0, 8).map((item) => Object.freeze(item)),
    );
  }

  private longitudinalDecision(
    input: ConversationReasoningBridgeInput,
  ): string | null {
    if (!input.longitudinal) return null;
    const labels: Readonly<Record<typeof input.longitudinal.decision, string>> =
      {
        KEEP_PLAN: 'manter o plano atual',
        ADAPT_PLAN: 'adaptar o plano ao momento atual',
        REVIEW: 'revisar o plano antes de avançar',
        DELOAD: 'reduzir temporariamente a exigência',
        INCREASE: 'aumentar a exigência de forma controlada',
        REDUCE: 'reduzir a exigência',
        WAIT: 'observar mais dados antes de mudar',
        ASK_INFORMATION: 'pedir uma informação antes de decidir',
      };
    return labels[input.longitudinal.decision];
  }

  private nutritionBenefit(intensity: string): string {
    return intensity === 'RESTRICTED'
      ? 'preservar segurança e evitar uma orientação excessiva'
      : intensity === 'LOW'
        ? 'facilitar uma mudança pequena e sustentável'
        : 'alinhar a orientação ao objetivo e à rotina';
  }

  private workoutBenefit(progression: string): string {
    const labels: Readonly<Record<string, string>> = {
      MAINTAIN: 'consolidar a execução antes de avançar',
      PROGRESS: 'promover evolução gradual',
      REGRESS: 'adequar o estímulo ao momento atual',
      DELOAD: 'favorecer recuperação antes de nova progressão',
      REASSESS: 'confirmar condições antes de alterar o treino',
      PAUSE: 'preservar segurança antes de retomar',
    };
    return labels[progression] ?? 'adequar o treino ao contexto atual';
  }

  private progressLabel(state: string): string {
    const labels: Readonly<Record<string, string>> = {
      IMPROVING: 'Há sinais consistentes de melhora.',
      STABLE: 'O progresso está estável.',
      PLATEAU: 'O progresso está sem mudança relevante no momento.',
      REGRESSING: 'Há sinais recentes de queda que pedem atenção.',
      UNKNOWN: 'Ainda não há histórico suficiente para avaliar progresso.',
    };
    return labels[state] ?? 'O progresso ainda está em avaliação.';
  }

  private adherenceLabel(level: string, trend: string): string {
    const levelLabel = this.lowerLabel(level);
    const trendLabel = this.lowerLabel(trend);
    return `A aderência está ${levelLabel}, com tendência ${trendLabel}.`;
  }

  private lowerLabel(value: string): string {
    const labels: Readonly<Record<string, string>> = {
      HIGH: 'alta',
      MODERATE: 'moderada',
      LOW: 'baixa',
      UNKNOWN: 'ainda indefinida',
      IMPROVING: 'em melhora',
      STABLE: 'estável',
      DECLINING: 'em queda',
      ON_TRACK: 'dentro do esperado',
      AT_RISK: 'em atenção',
      OFF_TRACK: 'fora do esperado',
    };
    return labels[value] ?? 'em acompanhamento';
  }

  private adaptationLabel(mode: string): string {
    const labels: Readonly<Record<string, string>> = {
      TECHNICAL:
        'A continuidade pede uma orientação mais objetiva e explicativa.',
      ENCOURAGING:
        'A continuidade pede reforço de uma ação simples e possível.',
      RECOVERY:
        'A continuidade pede recuperação gradual antes de ampliar mudanças.',
      PERFORMANCE:
        'A continuidade pode conectar o próximo passo ao desempenho.',
    };
    return labels[mode] ?? 'A continuidade deve respeitar o momento atual.';
  }
}
