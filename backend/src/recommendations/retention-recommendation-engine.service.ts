import { Injectable } from '@nestjs/common';
import { RecommendationCategory, RecommendationPriority } from '@prisma/client';
import {
  RecommendationCandidate,
  RetentionRecommendationEngineInput,
} from './interfaces/recommendation.interface';

@Injectable()
export class RetentionRecommendationEngineService {
  generate(
    input: RetentionRecommendationEngineInput,
  ): RecommendationCandidate[] {
    const candidates: RecommendationCandidate[] = [];

    if (input.churn?.level === 'HIGH' || input.churn?.level === 'MEDIUM') {
      candidates.push({
        category: RecommendationCategory.RETENTION,
        priority:
          input.churn.level === 'HIGH' && input.churn.daysInactive >= 7
            ? RecommendationPriority.CRITICAL
            : RecommendationPriority.HIGH,
        signalKey: 'RETENTION:CHURN_RECOVERY',
        title: 'Retome pelo menor registro possível',
        description:
          'Envie ou registre apenas a próxima refeição. O objetivo agora é recuperar continuidade, não compensar os dias anteriores.',
        reason: `O risco de abandono está ${input.churn.level.toLocaleLowerCase('pt-BR')}, com ${input.churn.daysInactive} dia(s) sem interação.`,
        evidence: {
          churnLevel: input.churn.level,
          daysInactive: input.churn.daysInactive,
          activityDrop: input.churn.activityDrop,
        },
        confidence: {
          contextSources: 3,
          historyDepth: Math.max(1, input.churn.daysInactive),
          recurrence: Math.max(1, Math.round(input.churn.activityDrop / 20)),
          signalStrength: input.churn.level === 'HIGH' ? 95 : 75,
        },
      });
    }

    if (input.engagement && input.engagement.score < 55) {
      candidates.push({
        category: RecommendationCategory.ENGAGEMENT,
        priority:
          input.engagement.score < 35
            ? RecommendationPriority.HIGH
            : RecommendationPriority.MEDIUM,
        signalKey: 'RETENTION:LOW_ENGAGEMENT',
        title: 'Reative o acompanhamento com uma interação curta',
        description:
          'Faça um registro simples hoje ou responda com a principal dificuldade da sua rotina alimentar.',
        reason: `O engajamento recente está em ${input.engagement.score}/100.`,
        evidence: {
          engagementScore: input.engagement.score,
          messagesLast7Days: input.engagement.messagesLast7Days,
          analysesLast7Days: input.engagement.analysesLast7Days,
        },
        confidence: {
          contextSources: 3,
          historyDepth:
            input.engagement.messagesLast7Days +
            input.engagement.analysesLast7Days,
          recurrence: input.engagement.score < 35 ? 4 : 2,
          signalStrength: 100 - input.engagement.score,
        },
      });
    }

    if (input.consistency && input.consistency.score < 55) {
      candidates.push({
        category: RecommendationCategory.HABIT,
        priority: RecommendationPriority.MEDIUM,
        signalKey: 'RETENTION:LOW_CONSISTENCY',
        title: 'Proteja a continuidade antes da perfeição',
        description:
          'Escolha um único horário ou refeição para manter o registro pelos próximos dias.',
        reason: `A consistência está em ${input.consistency.score}/100 e a continuidade em ${input.consistency.continuityScore}/100.`,
        evidence: {
          consistencyScore: input.consistency.score,
          continuityScore: input.consistency.continuityScore,
        },
        confidence: {
          contextSources: 2,
          historyDepth: 4,
          recurrence: input.consistency.score < 35 ? 4 : 2,
          signalStrength: 100 - input.consistency.score,
        },
      });
    }

    return candidates;
  }
}
