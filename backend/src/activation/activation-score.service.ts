import { Injectable } from '@nestjs/common';
import {
  ActivationRiskLevel,
  ActivationStage,
  UserActivation,
} from '@prisma/client';

const HOUR_MS = 3_600_000;

@Injectable()
export class ActivationScoreService {
  calculate(
    activation: Pick<
      UserActivation,
      | 'registeredAt'
      | 'paidAt'
      | 'whatsappConnectedAt'
      | 'firstMessageSentAt'
      | 'firstMealReceivedAt'
      | 'firstAnalysisCompletedAt'
      | 'firstRecommendationDeliveredAt'
      | 'firstCoachInteractionAt'
    >,
  ): number {
    return (
      (activation.registeredAt ? 5 : 0) +
      (activation.paidAt ? 10 : 0) +
      (activation.whatsappConnectedAt ? 5 : 0) +
      (activation.firstMessageSentAt ? 5 : 0) +
      (activation.firstMealReceivedAt ? 20 : 0) +
      (activation.firstAnalysisCompletedAt ? 20 : 0) +
      (activation.firstRecommendationDeliveredAt ? 20 : 0) +
      (activation.firstCoachInteractionAt ? 15 : 0)
    );
  }

  risk(
    activation: Pick<
      UserActivation,
      'currentStage' | 'lastProgressAt' | 'firstMealReceivedAt'
    >,
    at = new Date(),
  ): ActivationRiskLevel {
    if (activation.currentStage === ActivationStage.ACTIVATED) {
      return ActivationRiskLevel.LOW;
    }

    if (activation.currentStage === ActivationStage.ABANDONED) {
      return ActivationRiskLevel.HIGH;
    }

    const stalledHours = this.stalledHours(activation.lastProgressAt, at);

    if (
      stalledHours >= 72 ||
      (!activation.firstMealReceivedAt && stalledHours >= 48)
    ) {
      return ActivationRiskLevel.HIGH;
    }

    if (stalledHours >= 24) {
      return ActivationRiskLevel.MEDIUM;
    }

    return ActivationRiskLevel.LOW;
  }

  stalledHours(lastProgressAt: Date, at = new Date()): number {
    return Math.max(
      0,
      Math.floor((at.getTime() - lastProgressAt.getTime()) / HOUR_MS),
    );
  }
}
