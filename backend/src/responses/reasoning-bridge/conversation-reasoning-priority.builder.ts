import type {
  NutritionReasoningPriority,
  NutritionReasoningResult,
} from '../../nutrition-reasoning/nutrition-reasoning.contract';
import type {
  WorkoutReasoningPriority,
  WorkoutReasoningResult,
} from '../../workout-reasoning/workout-reasoning.contract';
import type { LongitudinalPriority } from '../../longitudinal-coaching/longitudinal-coaching.contract';
import type {
  ConversationReasoningBridgeInput,
  ConversationReasoningImportance,
  ConversationReasoningPriorityEvidence,
} from './conversation-reasoning-bridge.contract';

interface PriorityCandidate {
  readonly topic: string;
  readonly priority:
    | NutritionReasoningPriority
    | WorkoutReasoningPriority
    | LongitudinalPriority;
  readonly explanation: string;
}

const IMPORTANCE_RANK: Readonly<
  Record<ConversationReasoningImportance, number>
> = Object.freeze({ essencial: 0, alta: 1, moderada: 2, complementar: 3 });

export class ConversationReasoningPriorityBuilder {
  build(
    input: ConversationReasoningBridgeInput,
  ): readonly ConversationReasoningPriorityEvidence[] {
    const candidates = [
      ...this.nutrition(input.nutrition),
      ...this.workout(input.workout),
      ...this.longitudinal(input),
    ]
      .map((item) => this.toEvidence(item))
      .filter(
        (item): item is ConversationReasoningPriorityEvidence => item !== null,
      );
    const unique = new Map<string, ConversationReasoningPriorityEvidence>();
    for (const candidate of candidates) {
      const current = unique.get(candidate.topic);
      if (
        !current ||
        IMPORTANCE_RANK[candidate.importance] <
          IMPORTANCE_RANK[current.importance]
      ) {
        unique.set(candidate.topic, Object.freeze(candidate));
      }
    }
    return Object.freeze(
      [...unique.values()]
        .sort(
          (left, right) =>
            IMPORTANCE_RANK[left.importance] -
              IMPORTANCE_RANK[right.importance] ||
            left.topic.localeCompare(right.topic, 'pt-BR'),
        )
        .slice(0, 8),
    );
  }

  private nutrition(
    result: NutritionReasoningResult | null | undefined,
  ): readonly PriorityCandidate[] {
    if (!result) return [];
    return [
      {
        topic: 'aderência',
        priority: result.priorities.adherence,
        explanation: 'A orientação precisa continuar viável no dia a dia.',
      },
      {
        topic: 'desempenho',
        priority: result.priorities.performance,
        explanation: 'Energia e escolhas devem apoiar o esforço realizado.',
      },
      {
        topic: 'recuperação',
        priority: result.priorities.recovery,
        explanation:
          'A recuperação influencia a continuidade e o próximo treino.',
      },
      {
        topic: 'educação nutricional',
        priority: result.priorities.education,
        explanation: 'Entender a escolha aumenta autonomia.',
      },
      {
        topic: 'praticidade',
        priority: result.priorities.practicality,
        explanation: 'A recomendação deve caber no tempo e na rotina.',
      },
      {
        topic: 'economia',
        priority: result.priorities.economy,
        explanation: 'As opções precisam respeitar o orçamento disponível.',
      },
      {
        topic: 'saciedade',
        priority: result.priorities.satiety,
        explanation: 'A estrutura alimentar deve ajudar no controle da fome.',
      },
      {
        topic: 'mudança sustentável',
        priority: result.priorities.behavior,
        explanation: 'O próximo passo deve ser possível de repetir.',
      },
      ...(result.metadata.safetyRestricted
        ? [
            {
              topic: 'segurança',
              priority: 'CRITICAL' as const,
              explanation:
                'Os limites informados precisam prevalecer sobre qualquer otimização.',
            },
          ]
        : []),
    ];
  }

  private workout(
    result: WorkoutReasoningResult | null | undefined,
  ): readonly PriorityCandidate[] {
    if (!result) return [];
    return [
      {
        topic: 'segurança',
        priority: result.priorities.safety,
        explanation: 'O treino deve respeitar o estado e os limites atuais.',
      },
      {
        topic: 'técnica',
        priority: result.priorities.technique,
        explanation:
          'A qualidade da execução vem antes do aumento de exigência.',
      },
      {
        topic: 'aderência',
        priority: result.priorities.adherence,
        explanation: 'O plano precisa ser executável de forma consistente.',
      },
      {
        topic: 'recuperação',
        priority: result.priorities.recovery,
        explanation: 'A recuperação define quanto estímulo faz sentido agora.',
      },
      {
        topic: 'progressão',
        priority: result.priorities.progression,
        explanation: 'A evolução deve ocorrer sem saltos incompatíveis.',
      },
      {
        topic: 'praticidade',
        priority: result.priorities.practicality,
        explanation: 'A sessão precisa caber na rotina disponível.',
      },
      {
        topic: 'equipamentos disponíveis',
        priority: result.priorities.equipment,
        explanation: 'Os exercícios devem usar recursos realmente disponíveis.',
      },
      {
        topic: 'ambiente de treino',
        priority: result.priorities.environment,
        explanation: 'A sessão deve ser compatível com o local de execução.',
      },
    ];
  }

  private longitudinal(
    input: ConversationReasoningBridgeInput,
  ): readonly PriorityCandidate[] {
    if (!input.longitudinal) return [];
    return [
      {
        topic: 'segurança',
        priority: input.longitudinal.priorities.safety,
        explanation:
          'Sinais de cautela prevalecem sobre progressão automática.',
      },
      {
        topic: 'alimentação',
        priority: input.longitudinal.priorities.nutrition,
        explanation: 'A evolução alimentar observada orienta o próximo passo.',
      },
      {
        topic: 'treino',
        priority: input.longitudinal.priorities.training,
        explanation: 'A evolução do treino orienta manutenção ou ajuste.',
      },
      {
        topic: 'continuidade',
        priority: input.longitudinal.priorities.behavioral,
        explanation:
          'A aderência ao longo do tempo orienta a intensidade da mudança.',
      },
    ];
  }

  private toEvidence(
    candidate: PriorityCandidate,
  ): ConversationReasoningPriorityEvidence | null {
    const importance = this.importance(candidate.priority);
    return importance
      ? {
          topic: candidate.topic,
          importance,
          explanation: candidate.explanation,
        }
      : null;
  }

  private importance(
    priority:
      | NutritionReasoningPriority
      | WorkoutReasoningPriority
      | LongitudinalPriority,
  ): ConversationReasoningImportance | null {
    const labels: Readonly<
      Record<
        | NutritionReasoningPriority
        | WorkoutReasoningPriority
        | LongitudinalPriority,
        ConversationReasoningImportance | null
      >
    > = {
      CRITICAL: 'essencial',
      HIGH: 'alta',
      MEDIUM: 'moderada',
      LOW: 'complementar',
      IGNORED: null,
      NONE: null,
    };
    return labels[priority];
  }
}
