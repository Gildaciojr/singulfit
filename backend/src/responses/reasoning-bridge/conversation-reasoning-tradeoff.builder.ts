import type { NutritionReasoningConflict } from '../../nutrition-reasoning/nutrition-reasoning.contract';
import type { WorkoutReasoningConflict } from '../../workout-reasoning/workout-reasoning.contract';
import type {
  ConversationReasoningBridgeInput,
  ConversationReasoningTradeoffEvidence,
} from './conversation-reasoning-bridge.contract';

const NUTRITION_TRADEOFFS: Readonly<
  Record<NutritionReasoningConflict, ConversationReasoningTradeoffEvidence>
> = Object.freeze({
  HYPERTROPHY_LOW_BUDGET: {
    preferred: 'fontes acessíveis de proteína e energia',
    deprioritized: 'opções de maior custo',
    explanation:
      'O objetivo muscular foi preservado com escolhas compatíveis com o orçamento.',
  },
  WEIGHT_LOSS_EATING_OUT_LOW_ADHERENCE: {
    preferred: 'uma escolha simples e repetível',
    deprioritized: 'controle alimentar complexo',
    explanation:
      'A continuidade foi priorizada para evitar uma estratégia difícil de sustentar fora de casa.',
  },
  CROSSFIT_LIMITED_TIME: {
    preferred: 'energia prática ao redor do treino',
    deprioritized: 'preparações demoradas',
    explanation: 'O suporte ao treino foi mantido dentro do tempo disponível.',
  },
  RUNNING_INADEQUATE_HYDRATION: {
    preferred: 'regularidade da hidratação',
    deprioritized: 'otimização de desempenho antes da base hídrica',
    explanation:
      'A hidratação foi priorizada antes de ampliar exigências de performance.',
  },
  VEGAN_PROTEIN: {
    preferred: 'combinação de fontes vegetais de proteína',
    deprioritized: 'fontes incompatíveis com o padrão alimentar',
    explanation:
      'A prioridade proteica foi preservada sem contrariar o padrão informado.',
  },
  REJECTIONS_LOW_BUDGET: {
    preferred: 'poucas substituições acessíveis',
    deprioritized: 'variedade extensa',
    explanation: 'O plano favoreceu opções aceitas e economicamente viáveis.',
  },
  PRACTICALITY_VARIETY: {
    preferred: 'simplicidade com variedade controlada',
    deprioritized: 'muitas opções simultâneas',
    explanation:
      'A praticidade foi priorizada sem eliminar completamente a diversidade.',
  },
});

const WORKOUT_TRADEOFFS: Readonly<
  Record<WorkoutReasoningConflict, ConversationReasoningTradeoffEvidence>
> = Object.freeze({
  HYPERTROPHY_LIMITED_TIME: {
    preferred: 'movimentos de maior utilidade por sessão',
    deprioritized: 'volume extenso',
    explanation:
      'O estímulo muscular foi preservado dentro do tempo disponível.',
  },
  STRENGTH_BEGINNER: {
    preferred: 'técnica e progressão gradual',
    deprioritized: 'aumento rápido de carga',
    explanation: 'A construção de base foi priorizada antes da intensidade.',
  },
  RUNNING_RETURN_AFTER_BREAK: {
    preferred: 'retorno gradual',
    deprioritized: 'distância ou intensidade avançada',
    explanation:
      'A continuidade foi priorizada para reduzir excesso de esforço na retomada.',
  },
  RUNNING_LIMITED_TIME: {
    preferred: 'sessão curta e objetiva',
    deprioritized: 'treino longo',
    explanation: 'O treino foi adequado ao tempo realmente disponível.',
  },
  CYCLING_WITHOUT_METRICS: {
    preferred: 'percepção de esforço',
    deprioritized: 'zonas precisas sem dados',
    explanation:
      'A orientação evitou inventar métricas que não foram fornecidas.',
  },
  CROSSFIT_BEGINNER: {
    preferred: 'escala e técnica',
    deprioritized: 'movimentos avançados',
    explanation: 'A execução segura foi priorizada antes da complexidade.',
  },
  HOME_WITHOUT_EQUIPMENT: {
    preferred: 'movimentos compatíveis com o ambiente',
    deprioritized: 'exercícios dependentes de equipamentos',
    explanation: 'A sessão foi ajustada aos recursos disponíveis.',
  },
  LOW_ADHERENCE_COMPLEX_PLAN: {
    preferred: 'estrutura simples',
    deprioritized: 'muitas decisões e variações',
    explanation: 'A consistência foi priorizada antes da complexidade.',
  },
  SPORT_OBJECTIVE_PHYSICAL_LIMITATION: {
    preferred: 'adaptação conservadora',
    deprioritized: 'progressão automática',
    explanation: 'Os limites atuais prevaleceram sobre o objetivo esportivo.',
  },
  PROGRESSION_FATIGUE: {
    preferred: 'recuperação e manutenção',
    deprioritized: 'novo aumento de exigência',
    explanation: 'A fadiga indicou que progredir agora teria pouco benefício.',
  },
  INTENSITY_INSUFFICIENT_RECOVERY: {
    preferred: 'recuperação entre sessões',
    deprioritized: 'alta intensidade',
    explanation:
      'A recuperação foi priorizada para sustentar os próximos treinos.',
  },
  MODALITY_PROFILE_MISMATCH: {
    preferred: 'confirmação da modalidade',
    deprioritized: 'prescrição baseada em suposição',
    explanation:
      'A decisão evitou assumir uma modalidade incompatível com o perfil.',
  },
  MODALITY_ENVIRONMENT_INCOMPATIBLE: {
    preferred: 'treino compatível com o local',
    deprioritized: 'estrutura inviável no ambiente disponível',
    explanation: 'A execução real foi priorizada sobre a estrutura idealizada.',
  },
  EXPERIENCE_PROFILE_CONFLICT: {
    preferred: 'complexidade conservadora',
    deprioritized: 'estratégia avançada sem confirmação',
    explanation:
      'A experiência precisa ser confirmada antes de ampliar a complexidade.',
  },
});

export class ConversationReasoningTradeoffBuilder {
  build(
    input: ConversationReasoningBridgeInput,
  ): readonly ConversationReasoningTradeoffEvidence[] {
    const candidates = [
      ...(input.nutrition?.resolvedConflicts.map(
        (item) => NUTRITION_TRADEOFFS[item.conflict],
      ) ?? []),
      ...(input.workout?.resolvedConflicts.map(
        (item) => WORKOUT_TRADEOFFS[item.conflict],
      ) ?? []),
    ];
    const unique = new Map(candidates.map((item) => [item.explanation, item]));
    return Object.freeze(
      [...unique.values()].slice(0, 4).map((item) => Object.freeze(item)),
    );
  }
}
