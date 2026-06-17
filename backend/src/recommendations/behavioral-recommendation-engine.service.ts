import { Injectable } from '@nestjs/common';
import {
  BehavioralMotivationStyle,
  RecommendationCategory,
  RecommendationPriority,
  StageOfChange,
} from '@prisma/client';
import {
  BehavioralRecommendationEngineInput,
  RecommendationCandidate,
} from './interfaces/recommendation.interface';

@Injectable()
export class BehavioralRecommendationEngineService {
  generate(
    input: BehavioralRecommendationEngineInput,
  ): RecommendationCandidate[] {
    const candidates: RecommendationCandidate[] = [];
    const motivation =
      input.motivations[0]?.type ??
      input.profile?.motivationStyle ??
      BehavioralMotivationStyle.HEALTH;
    const trigger = input.triggers[0];

    if (input.adherence && input.adherence.score < 60) {
      candidates.push({
        category: RecommendationCategory.BEHAVIOR,
        priority:
          input.adherence.score < 40
            ? RecommendationPriority.HIGH
            : RecommendationPriority.MEDIUM,
        signalKey: 'BEHAVIOR:LOW_ADHERENCE',
        title: 'Reduza o próximo passo',
        description:
          'Escolha uma única ação alimentar que caiba no seu dia e repita-a antes de aumentar a exigência.',
        reason: `A adesão prevista está em ${input.adherence.score}/100, com espaço para uma ação mais simples e sustentável.`,
        evidence: {
          adherenceScore: input.adherence.score,
          consistencyScore: input.adherence.consistencyScore,
          responseScore: input.adherence.responseScore,
          motivation,
        },
        confidence: {
          contextSources: input.profile ? 4 : 3,
          historyDepth: 4,
          recurrence: input.adherence.score < 40 ? 4 : 2,
          signalStrength: 100 - input.adherence.score,
        },
      });
    }

    if (
      input.stage === StageOfChange.CONTEMPLATION ||
      input.stage === StageOfChange.PREPARATION
    ) {
      candidates.push({
        category: RecommendationCategory.COACHING,
        priority: RecommendationPriority.MEDIUM,
        signalKey: `BEHAVIOR:STAGE:${input.stage}`,
        title:
          input.stage === StageOfChange.CONTEMPLATION
            ? 'Transforme intenção em uma escolha'
            : 'Defina uma ação específica',
        description:
          input.stage === StageOfChange.CONTEMPLATION
            ? 'Escolha um benefício que realmente importa para você e teste uma mudança pequena na próxima refeição.'
            : 'Defina qual ação fará, em qual refeição e qual alternativa usará se o dia sair do planejado.',
        reason: `A recomendação respeita seu estágio atual de ${input.stage.toLocaleLowerCase('pt-BR')}.`,
        evidence: {
          stage: input.stage,
          motivation,
          trigger: trigger?.type ?? null,
          triggerWeight: trigger?.weight ?? 0,
        },
        confidence: {
          contextSources: 4,
          historyDepth: input.adherence ? 3 : 1,
          recurrence: 2,
          signalStrength: input.profile
            ? Math.round(input.profile.confidenceScore * 100)
            : 60,
        },
      });
    }

    if (
      trigger &&
      input.adherence &&
      input.adherence.score >= 60 &&
      input.adherence.score < 80
    ) {
      candidates.push({
        category: RecommendationCategory.COACHING,
        priority: RecommendationPriority.LOW,
        signalKey: `BEHAVIOR:TRIGGER:${trigger.type}`,
        title: 'Use seu principal gatilho a favor da consistência',
        description: this.triggerAction(trigger.type),
        reason: `O gatilho ${trigger.type.toLocaleLowerCase('pt-BR')} tem peso ${trigger.weight}/100 no seu perfil atual.`,
        evidence: {
          trigger: trigger.type,
          triggerWeight: trigger.weight,
          motivation,
          adherenceScore: input.adherence.score,
        },
        confidence: {
          contextSources: 4,
          historyDepth: 3,
          recurrence: 2,
          signalStrength: trigger.weight,
        },
      });
    }

    return candidates;
  }

  private triggerAction(trigger: string): string {
    const actions: Record<string, string> = {
      PROGRESS:
        'Compare apenas um indicador da semana e escolha a menor ação capaz de mantê-lo avançando.',
      CHALLENGE:
        'Transforme a próxima escolha em um desafio pequeno, claro e possível de concluir hoje.',
      REWARD:
        'Reconheça o compromisso cumprido com uma recompensa não alimentar e compatível com sua rotina.',
      HEALTH:
        'Escolha uma ação que melhore sua energia hoje e ainda seja repetível amanhã.',
      FAMILY:
        'Use uma refeição compartilhada como ponto de apoio para uma escolha simples e equilibrada.',
      SELF_ESTEEM:
        'Registre um compromisso pequeno cumprido para reforçar confiança no processo.',
      PERFORMANCE:
        'Use a próxima refeição para apoiar energia, recuperação e desempenho sem mudanças extremas.',
    };

    return actions[trigger] ?? actions.HEALTH;
  }
}
